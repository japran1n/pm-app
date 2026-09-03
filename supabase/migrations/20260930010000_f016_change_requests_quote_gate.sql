-- F016 (missions/20260903-portal, M3 — change requests: triage, quote,
-- gate): extends `client_requests` with triage/quote columns, hardens
-- `accept_client_request_atomic` so a change request cannot become a task
-- until the client has approved its quote (AS-047), adds
-- `send_change_request_quote_atomic` (the team's triage/quote write path),
-- and a trigger that reads the client's decision back off F007's own
-- `approval_requests` mechanism (decision_type = 'commercial') rather than
-- building a second decision path.
--
-- Existing rows: `kind` defaults to 'change', `client_decision` defaults
-- to 'pending', every new verdict/quote column is nullable. Per this
-- feature's own spec ("this migration does not retroactively gate
-- history"), the gate below only fires when `scope_verdict =
-- 'change_request'` — a pre-existing accepted row has `scope_verdict is
-- null` (backfilled by the `default` on the new column, which does not
-- apply retroactively to existing NULLs... but nullable + never written
-- means every existing row reads `scope_verdict is null`, not
-- 'change_request'), so the new gate is simply never reached for it, and
-- an already-`accepted` row is untouched by this migration in any case
-- (the gate only runs on the not-yet-accepted path).

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------

alter table public.client_requests
  add column if not exists kind text not null default 'change'
    check (kind in ('bug', 'change', 'new_work', 'question')),
  add column if not exists severity text
    check (severity in ('blocker', 'major', 'minor')),
  add column if not exists scope_verdict text
    check (scope_verdict in ('in_scope', 'change_request', 'warranty')),
  add column if not exists quoted_hours numeric
    check (quoted_hours > 0),
  add column if not exists quoted_amount numeric
    check (quoted_amount >= 0),
  add column if not exists quote_currency text,
  add column if not exists quote_note text,
  add column if not exists quote_valid_until date,
  add column if not exists client_decision text not null default 'pending'
    check (client_decision in ('pending', 'approved', 'rejected')),
  add column if not exists decided_by uuid references auth.users (id),
  add column if not exists decided_at timestamptz,
  add column if not exists track text
    check (track in ('design_change', 'dev_change', 'content_seo')),
  -- The team's own override of the proposed track, and why — the spec's
  -- "propose the track, let the team override, and log the override".
  -- Nullable: most requests take the proposed track as-is.
  add column if not exists track_overridden boolean not null default false,
  add column if not exists track_override_reason text,
  -- The approval request the quote was sent through, once one exists.
  -- No FK enforced at the column level beyond the reference itself —
  -- matches approval_requests.subject_id's own polymorphic convention
  -- (this table now has exactly one caller of that convention: itself).
  add column if not exists approval_request_id uuid
    references public.approval_requests (id) on delete set null;

comment on column public.client_requests.kind is
  'F016: bug | change | new_work | question — the team''s own triage bucket, independent of scope_verdict.';
comment on column public.client_requests.scope_verdict is
  'F016: in_scope (no quote needed) | change_request (must be quoted + approved before acceptance, AS-047) | warranty (a bug the team owns, no quote).';
comment on column public.client_requests.client_decision is
  'F016: the client''s decision on the quote, mirrored here from approval_requests.state by client_requests_sync_decision_from_approval (this migration) — never written directly by any client-facing write path.';

create index if not exists client_requests_scope_verdict_idx
  on public.client_requests (scope_verdict)
  where scope_verdict = 'change_request';

-- ---------------------------------------------------------------------
-- 2. send_change_request_quote_atomic — the team's triage + quote write
-- path. One transaction: set verdict/quote/track columns, then (only for
-- scope_verdict = 'change_request') raise the client's approval through
-- F007's own mechanism — an `approval_requests` row with
-- decision_type = 'commercial', subject_type = 'artifact' (a quote is not
-- a task/doc/phase), artifact_url pointing back at the portal's requests
-- view, subject_id = the client_requests row so the sync trigger below
-- can find its way back. Mirrors accept_client_request_atomic's own
-- membership + teamCanTriage + portal-enabled preamble (F006n's own
-- template, named in that migration's NOTE FOR F016 comment) rather than
-- re-deriving it.
-- ---------------------------------------------------------------------

create or replace function public.send_change_request_quote_atomic(
  p_request_id uuid,
  p_scope_verdict text,
  p_severity text default null,
  p_quoted_hours numeric default null,
  p_quoted_amount numeric default null,
  p_quote_currency text default null,
  p_quote_note text default null,
  p_quote_valid_until date default null,
  p_track text default null,
  p_track_overridden boolean default false,
  p_track_override_reason text default null,
  p_portal_url text default null
)
returns table (
  request_id uuid,
  scope_verdict text,
  approval_request_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_title text;
  v_status text;
  v_caller_role text;
  v_approval_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_scope_verdict not in ('in_scope', 'change_request', 'warranty') then
    raise exception 'send_change_request_quote_atomic: invalid scope_verdict %', p_scope_verdict
      using errcode = '22023';
  end if;

  select cr.project_id, cr.title, cr.status, p.workspace_id
    into v_project_id, v_title, v_status, v_workspace_id
    from public.client_requests cr
    join public.projects p on p.id = cr.project_id
   where cr.id = p_request_id
     for update of cr;

  if v_project_id is null then
    raise exception 'request not found';
  end if;

  if v_status = 'accepted' then
    raise exception 'this request has already been accepted';
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

  if not public.is_project_portal_enabled(v_project_id) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if p_scope_verdict = 'change_request' and (p_quoted_amount is null or p_quote_valid_until is null) then
    raise exception 'a change request quote needs an amount and a validity date'
      using errcode = '22023';
  end if;

  update public.client_requests
     set scope_verdict = p_scope_verdict,
         severity = p_severity,
         quoted_hours = p_quoted_hours,
         quoted_amount = p_quoted_amount,
         quote_currency = p_quote_currency,
         quote_note = p_quote_note,
         quote_valid_until = p_quote_valid_until,
         track = p_track,
         track_overridden = coalesce(p_track_overridden, false),
         track_override_reason = case when coalesce(p_track_overridden, false) then p_track_override_reason else null end,
         -- A fresh quote reopens the decision: any earlier approve/reject
         -- on a previous quote no longer speaks to the new price.
         client_decision = case when p_scope_verdict = 'change_request' then 'pending' else client_decision end,
         status = case when v_status = 'submitted' then 'in_review' else v_status end,
         reviewed_by = v_user_id,
         reviewed_at = now()
   where id = p_request_id;

  if p_scope_verdict = 'change_request' then
    insert into public.approval_requests (
      project_id, subject_type, subject_id, artifact_url, title, description,
      decision_type, requested_by, due_at
    )
    values (
      v_project_id, 'artifact', p_request_id,
      coalesce(p_portal_url, 'about:blank'),
      'Quote: ' || v_title,
      p_quote_note,
      'commercial', v_user_id,
      case when p_quote_valid_until is not null then p_quote_valid_until::timestamptz else null end
    )
    returning id into v_approval_id;

    update public.client_requests
       set approval_request_id = v_approval_id
     where id = p_request_id;
  end if;

  return query select p_request_id, p_scope_verdict, v_approval_id;
end;
$$;

revoke all on function public.send_change_request_quote_atomic(
  uuid, text, text, numeric, numeric, text, text, date, text, boolean, text, text
) from public;
grant execute on function public.send_change_request_quote_atomic(
  uuid, text, text, numeric, numeric, text, text, date, text, boolean, text, text
) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Sync the client's decision back from approval_requests.
--
-- decide_approval_atomic (F007, 20260916010000) is the one and only place
-- a client's decision is recorded — this feature does not add a second
-- decision path. This trigger only mirrors that outcome onto the
-- originating client_requests row (client_decision/decided_by/decided_at)
-- so the portal and the acceptance gate below can read it without joining
-- through approval_requests every time, and — on approval — adds the
-- project_scope_items row F012 already provides for exactly this
-- ("source = 'change_request'").
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

  select cr.id, cr.project_id, cr.title, cr.body
    into v_request
    from public.client_requests cr
   where cr.id = NEW.subject_id
     and cr.approval_request_id = NEW.id;

  if v_request.id is null then
    -- Not one of ours (subject_id is a generic polymorphic column; some
    -- other future decision_type='commercial'/subject_type='artifact'
    -- approval unrelated to a change request could exist one day).
    return NEW;
  end if;

  update public.client_requests
     set client_decision = case when NEW.state = 'approved' then 'approved' else 'rejected' end,
         decided_by = NEW.decided_by,
         decided_at = NEW.decided_at
   where id = v_request.id;

  if NEW.state = 'approved' then
    insert into public.project_scope_items (
      project_id, title, description, included, source, change_request_id
    )
    values (
      v_request.project_id, v_request.title, v_request.body, true, 'change_request', v_request.id
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists client_requests_sync_decision_from_approval on public.approval_requests;
create trigger client_requests_sync_decision_from_approval
  after update on public.approval_requests
  for each row
  execute function public.client_requests_sync_decision_from_approval();

-- ---------------------------------------------------------------------
-- 4. The gate (AS-047) — inside accept_client_request_atomic itself, per
-- F006n's own NOTE FOR F016: right after the existing portal gate, before
-- the row lock decision. A change_request cannot become a task until the
-- client has approved (client_decision = 'approved'), and not even then
-- if the quote has since expired — an expired quote needs a fresh one,
-- not a silent acceptance at a stale price. Pre-existing rows (no
-- scope_verdict) are untouched: the check only applies when
-- scope_verdict = 'change_request'.
-- ---------------------------------------------------------------------

create or replace function public.accept_client_request_atomic(
  p_request_id uuid
)
returns table (task_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_title text;
  v_body text;
  v_desired_by date;
  v_status text;
  v_task_id uuid;
  v_caller_role text;
  v_scope_verdict text;
  v_client_decision text;
  v_quote_valid_until date;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select cr.project_id, cr.title, cr.body, cr.desired_by, cr.status, p.workspace_id,
         cr.scope_verdict, cr.client_decision, cr.quote_valid_until
    into v_project_id, v_title, v_body, v_desired_by, v_status, v_workspace_id,
         v_scope_verdict, v_client_decision, v_quote_valid_until
    from public.client_requests cr
    join public.projects p on p.id = cr.project_id
   where cr.id = p_request_id
     for update of cr;

  if v_project_id is null then
    raise exception 'request not found';
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

  if v_caller_role = 'client' then
    raise exception 'a client cannot accept their own request'
      using errcode = '42501';
  end if;

  if not public.is_project_portal_enabled(v_project_id) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  -- AS-047: a change request cannot become a task until the client has
  -- approved its quote. Distinct, custom SQLSTATE ('CR047') so the UI can
  -- tell this apart from a generic failure and render "not yet approved"
  -- rather than a catch-all error toast. Also refuse an expired quote
  -- ('CR048') -- an expired quote needs a fresh one, not a silent
  -- acceptance at a stale price.
  if v_scope_verdict = 'change_request' then
    if v_client_decision is distinct from 'approved' then
      raise exception 'this change request has not been approved by the client yet'
        using errcode = 'CR047';
    end if;

    if v_quote_valid_until is not null and v_quote_valid_until < current_date then
      raise exception 'this change request''s quote has expired; send a fresh quote before accepting'
        using errcode = 'CR048';
    end if;
  end if;

  if v_status = 'accepted' then
    raise exception 'request already accepted';
  end if;

  insert into public.tasks (project_id, title, description, status, author_id, due_date, client_visible)
  values (v_project_id, v_title, v_body, 'todo', v_user_id, v_desired_by, true)
  returning id into v_task_id;

  update public.client_requests
     set status = 'accepted',
         decline_reason = null,
         converted_task_id = v_task_id,
         reviewed_by = v_user_id,
         reviewed_at = now()
   where id = p_request_id;

  return query select v_task_id;
end;
$$;

revoke all on function public.accept_client_request_atomic(uuid) from public;
grant execute on function public.accept_client_request_atomic(uuid) to authenticated;
