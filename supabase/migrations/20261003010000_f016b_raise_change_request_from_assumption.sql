-- F016b (missions/20260903-portal, M3 — "raise a change request from a
-- flagged assumption"): the Good Guys process rule ("an assumption that
-- turns out wrong is a change request, not a surprise") made mechanical.
--
-- Deferred twice for locally sound reasons (F015: F016's dialog did not
-- exist yet; F016: `client_requests`' INSERT policy is client-only by
-- design, per its own header comment "the one thing a client may
-- write" — a team member cannot INSERT a row there through RLS at all).
--
-- This feature does NOT touch that INSERT policy, and does not add a
-- second write surface. F016 itself already established the pattern for
-- a team-side write against `client_requests` that RLS alone would not
-- allow: a SECURITY DEFINER RPC (`send_change_request_quote_atomic`,
-- `accept_client_request_atomic`) that re-derives the caller's real
-- workspace role and bars viewer/client before writing, bypassing RLS
-- as its own owner rather than widening a policy meant for the client's
-- own writes. `raise_change_request_from_assumption_atomic` below is
-- the same shape applied to INSERT instead of UPDATE — one authorisation
-- surface, not a third.
--
-- Preamble (membership select, role bar, portal gate) mirrors
-- `accept_client_request_atomic` (20261001010000's own version, the one
-- still routed through `client_gate`) near verbatim, per this feature's
-- own instruction to match the existing bar rather than invent one.

-- ---------------------------------------------------------------------
-- 1. The link back to the assumption that produced this request.
-- ---------------------------------------------------------------------

alter table public.client_requests
  add column if not exists origin_assumption_id uuid
    references public.project_assumptions (id) on delete set null;

comment on column public.client_requests.origin_assumption_id is
  'F016b: set when this request was raised from a flagged project_assumptions row, via raise_change_request_from_assumption_atomic. Approving the resulting quote moves that assumption to invalidated (client_requests_sync_decision_from_approval).';

create index if not exists client_requests_origin_assumption_id_idx
  on public.client_requests (origin_assumption_id)
  where origin_assumption_id is not null;

-- ---------------------------------------------------------------------
-- 2. raise_change_request_from_assumption_atomic — creates the
-- client_requests row (kind = 'change', scope_verdict = 'change_request',
-- title/body pre-filled from the assumption's own text and the client's
-- flagged_note) so the team's existing quote dialog
-- (components/client-requests/quote-dialog.tsx) can open on it
-- immediately and be sent through F016's own, unmodified,
-- send_change_request_quote_atomic path. No approval_requests row is
-- raised here — that only happens once the team actually sends a quote,
-- exactly as it does for a client-filed request.
--
-- Only callable on an assumption the client has flagged
-- (flagged_by_client_at is not null) and still unconfirmed/uninvalidated
-- (state = 'assumed') — the same condition the Record panel's own
-- "Flagged by the client" highlight uses
-- (components/project/record-panel.tsx's AssumptionRow, isFlagged).
-- `created_by` is resolved to an active client of the workspace, not the
-- team caller raising it (see the function body's own comment for why:
-- it is both a correctness fit with is_project_client's own
-- workspace-scoped shape and a hard requirement, since
-- enforce_client_requests_triage_columns_immutable_by_author
-- (20261001010000) would otherwise block the same person from raising
-- and later triaging one request).
-- ---------------------------------------------------------------------

create or replace function public.raise_change_request_from_assumption_atomic(
  p_assumption_id uuid
)
returns table (
  request_id uuid,
  project_id uuid,
  title text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_text text;
  v_note text;
  v_state text;
  v_flagged_at timestamptz;
  v_caller_role text;
  v_client_id uuid;
  v_request_id uuid;
  v_title text;
  v_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: not authenticated'
      using errcode = '28000';
  end if;

  select pa.project_id, pa.text, pa.flagged_note, pa.state, pa.flagged_by_client_at, p.workspace_id
    into v_project_id, v_text, v_note, v_state, v_flagged_at, v_workspace_id
    from public.project_assumptions pa
    join public.projects p on p.id = pa.project_id
   where pa.id = p_assumption_id
     for update of pa;

  if v_project_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: assumption not found'
      using errcode = 'P0002';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active';

  if v_caller_role is null or v_caller_role = 'viewer' or v_caller_role = 'client' then
    raise exception 'caller does not have permission to review requests'
      using errcode = '42501';
  end if;

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  -- Same signal the Record panel's own "Flagged by the client" highlight
  -- uses: flagged and not yet confirmed/invalidated. A team member who
  -- disagrees with an unflagged assumption edits the row directly; this
  -- action exists for the client's own "not correct" signal only.
  if v_flagged_at is null or v_state <> 'assumed' then
    raise exception 'this assumption has not been flagged by the client'
      using errcode = 'CR050';
  end if;

  -- created_by is a client of the assumption's workspace, not the team
  -- caller raising this. Two independent reasons, not one convenience:
  --   1. is_project_client (every client-facing RLS predicate in this
  --      schema) is workspace-scoped, not project_members-scoped
  --      (lib/queries/approvals.ts's own getProjectClientMembers header
  --      comment, confirmed against 20260908010000's predicate) — there
  --      is no "the" client on a project's own membership row to prefer
  --      over this one, so any active client of the workspace is as
  --      correct as any other.
  --   2. enforce_client_requests_triage_columns_immutable_by_author
  --      (20261001010000) blocks the row's OWN author from writing its
  --      triage/quote/decision columns. Every other client_requests row
  --      is authored by a client and triaged by the team — two different
  --      people, so that guard never fires on the team's own triage.
  --      Setting created_by to the team caller here would make the team
  --      member who raises this the same person who later calls
  --      send_change_request_quote_atomic on it, tripping that guard
  --      the very first time anyone tried to quote it. Attributing the
  --      row to an actual client keeps it indistinguishable from every
  --      other request this table has ever held.
  -- A client can only have flagged this assumption via the portal in the
  -- first place (flag_assumption_atomic is client-only), so at least one
  -- active client of this workspace is guaranteed to exist.
  select wm.user_id into v_client_id
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.role = 'client'
     and wm.status = 'active'
   order by wm.user_id
   limit 1;

  if v_client_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: no active client on this workspace'
      using errcode = 'P0002';
  end if;

  v_title := left(v_text, 200);

  insert into public.client_requests (
    project_id, created_by, title, body, kind, scope_verdict, origin_assumption_id
  )
  values (
    v_project_id, v_client_id, v_title, v_note, 'change', 'change_request', p_assumption_id
  )
  returning client_requests.id, client_requests.created_at into v_request_id, v_created_at;

  return query select v_request_id, v_project_id, v_title, v_note, v_created_at;
end;
$$;

revoke all on function public.raise_change_request_from_assumption_atomic(uuid) from public;
grant execute on function public.raise_change_request_from_assumption_atomic(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. When the resulting change request's quote is approved, the
-- originating assumption moves to 'invalidated' — the team's call, made
-- explicit by the approval rather than a separate edit (this feature's
-- own spec, item 4). Folded into client_requests_sync_decision_from_
-- approval (the one place a client's decision on a quote is mirrored,
-- 20260930010000 / 20261002010000) rather than a second trigger, so
-- there remains exactly one place that reacts to
-- decide_approval_atomic's outcome for this table. Recreated here in
-- full (CREATE OR REPLACE replaces the whole body) — carries forward
-- 20261002010000's defect-3a/3b fixes and F016d's guard-bypass flag
-- unchanged, adds only the new origin_assumption_id branch at the end.
-- ---------------------------------------------------------------------

create or replace function public.client_requests_sync_decision_from_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request record;
begin
  if NEW.decision_type <> 'commercial' or NEW.subject_type <> 'artifact' then
    return NEW;
  end if;
  if OLD.state = NEW.state then
    return NEW;
  end if;
  if NEW.state not in ('approved', 'changes_requested') then
    return NEW;
  end if;

  select cr.id, cr.project_id, cr.title, cr.body, cr.origin_assumption_id
    into v_request
    from public.client_requests cr
   where cr.id = NEW.subject_id
     and cr.approval_request_id = NEW.id;

  if v_request.id is null then
    -- Not one of ours (subject_id is a generic polymorphic column; some
    -- other future decision_type='commercial'/subject_type='artifact'
    -- approval unrelated to a change request could exist one day) --
    -- or, per defect 3a, a withdrawn PRIOR approval whose decision
    -- arrives late: `approval_request_id` on the row has already moved
    -- on to a newer approval, so this join correctly finds nothing and
    -- the stale decision is dropped rather than mirrored.
    return NEW;
  end if;

  -- F016d's own guard (`enforce_client_requests_triage_columns_immutable_
  -- by_author`, 20261001010000) blocks the REQUEST'S OWN AUTHOR from
  -- writing these columns directly -- but a client deciding their own
  -- quote through decide_approval_atomic is exactly the case that must
  -- still work, and this trigger is what performs that write on the
  -- client's behalf. Same bypass flag 20261001010000 already
  -- established for this one trigger, carried over verbatim now that
  -- this function is being replaced again.
  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

  update public.client_requests
     set client_decision = case when NEW.state = 'approved' then 'approved' else 'rejected' end,
         decided_by = NEW.decided_by,
         decided_at = NEW.decided_at
   where id = v_request.id;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  if NEW.state = 'approved' then
    insert into public.project_scope_items (
      project_id, title, description, included, source, change_request_id
    )
    values (
      v_request.project_id, v_request.title, v_request.body, true, 'change_request', v_request.id
    )
    on conflict (change_request_id)
      where (source = 'change_request' and change_request_id is not null)
      do nothing;

    -- F016b: the change request this quote belongs to was raised from a
    -- flagged assumption -- the team's approval of the quote is the
    -- explicit call that the assumption was wrong, so it moves to
    -- 'invalidated' here rather than requiring a separate manual edit.
    -- Guarded by `state <> 'invalidated'` only for idempotency (a
    -- re-approval after a withdrawn/re-raised cycle should not error);
    -- it is not itself a source of the state's history, `state` stays a
    -- plain team-writable column exactly as F012 defined it.
    if v_request.origin_assumption_id is not null then
      update public.project_assumptions
         set state = 'invalidated'
       where id = v_request.origin_assumption_id
         and state <> 'invalidated';
    end if;
  end if;

  return NEW;
end;
$$;
