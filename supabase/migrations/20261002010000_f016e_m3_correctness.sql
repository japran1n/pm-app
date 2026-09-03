-- F016e (missions/20260903-portal, M3-scrutiny remediation): three of the
-- four defects the gate found need a schema/RPC change (the fourth,
-- AS-003's badge/list disagreement, is a pure read-side fix in
-- lib/queries/deliverables.ts and needed no migration).

-- ---------------------------------------------------------------------
-- Defect 2 (AS-048) — the portal's change-request list was scoped by
-- `created_by = auth.uid()`, not by project. AS-048's own wording is
-- "the portal shows EACH change request" for a project, not "each
-- change request this caller filed" -- two client users from the same
-- company each saw only the half they personally authored. Every other
-- client-facing SELECT policy F012 introduced in this same milestone
-- (client_deliverables_select_client, project_scope_items_select_client,
-- project_decisions_select_client, project_assumptions_select_client --
-- all four, 20260926010000:194-364) scopes a client caller by
-- `is_project_client(project_id) and is_project_visible_to(project_id)
-- and is_project_portal_enabled(project_id)`, never by row ownership.
-- This policy now matches that shape instead of being the one holdout.
-- ---------------------------------------------------------------------

drop policy if exists client_requests_select_author_or_team on public.client_requests;
create policy client_requests_select_author_or_team
  on public.client_requests
  for select
  to authenticated
  using (
    (
      public.is_project_client(project_id)
      and public.is_project_visible_to(project_id)
      and public.is_project_portal_enabled(project_id)
    )
    or (
      public.is_project_visible_to(project_id)
      and not public.is_project_client(project_id)
    )
  );

-- ---------------------------------------------------------------------
-- Defect 3a (re-quoting orphans an approval) -- a second
-- `send_change_request_quote_atomic` call for the same request left the
-- first quote's `approval_requests` row sitting at `state = 'pending'`.
-- Approving that stale row silently did nothing useful (the sync
-- trigger below reads `client_requests.approval_request_id`, which by
-- then points at the NEW row, so the stale approval's own decision
-- never reaches `client_requests`) and, if a client approved BOTH the
-- old and the new one before anyone noticed, each approval independently
-- fired the scope-item insert (defect 3b). Fix: withdraw the request's
-- current live approval (state = 'pending' only -- an already-decided
-- one is left alone, it is history, not the thing to disturb) before
-- raising a fresh one for the new quote. `'withdrawn'` is already a
-- valid `approval_requests.state` value (20260916010000:64) that no
-- write path had ever used until now.
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
  v_prior_approval_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_scope_verdict not in ('in_scope', 'change_request', 'warranty') then
    raise exception 'send_change_request_quote_atomic: invalid scope_verdict %', p_scope_verdict
      using errcode = '22023';
  end if;

  select cr.project_id, cr.title, cr.status, p.workspace_id, cr.approval_request_id
    into v_project_id, v_title, v_status, v_workspace_id, v_prior_approval_id
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

  -- Defect 3a: a fresh quote makes the PRIOR one moot. Withdraw it if it
  -- is still awaiting a decision -- an already-approved/rejected/
  -- withdrawn row is left exactly as it is, it is history.
  if v_prior_approval_id is not null then
    update public.approval_requests
       set state = 'withdrawn'
     where id = v_prior_approval_id
       and state = 'pending';
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
         reviewed_at = now(),
         -- The stale pointer is cleared here too, not just left to be
         -- overwritten a few lines down -- if scope_verdict is no longer
         -- 'change_request' this update is never reached below, and the
         -- row would otherwise keep pointing at a withdrawn approval.
         approval_request_id = null
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
-- Defect 3b (two scope items for one piece of work) -- even with 3a's
-- fix, a client could still have approved the first quote before the
-- team ever sent a second one (nothing wrong with that timing), and
-- then the RE-quote's own later approval would insert a SECOND
-- `project_scope_items` row for the same `change_request_id`. The
-- insert must be idempotent per request, not merely "usually only
-- happens once". A partial unique index is the actual constraint;
-- `on conflict ... do nothing` in the trigger is what makes the insert
-- safe to attempt twice, matching this table's own
-- `project_scope_items_source_check` convention of expressing the rule
-- as a real constraint rather than solely in application code.
-- ---------------------------------------------------------------------

create unique index if not exists project_scope_items_change_request_id_unique
  on public.project_scope_items (change_request_id)
  where source = 'change_request' and change_request_id is not null;

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
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------
-- Defect 4 (the sweep re-blocks a manually unblocked task) --
-- `sweep_overdue_blocking_deliverables`'s own header already promised
-- "only ever moves a task INTO blocked, never out" -- true, but nothing
-- stopped it moving the SAME task back in on the next hourly tick after
-- a human deliberately moved it out again, because the only thing the
-- query checked was the task's CURRENT column, not whether this exact
-- deliverable had already caused a sweep before. `swept_at` records that
-- once, on the deliverable itself (each `client_deliverables` row links
-- to at most one task, so "this pair was swept" and "this deliverable
-- was swept" are the same fact) -- the sweep now excludes any row that
-- already has one, regardless of what the linked task's column looks
-- like today. A human's decision to unblock a task now outlasts the
-- next cron tick, per this feature's own spec.
-- ---------------------------------------------------------------------

alter table public.client_deliverables
  add column if not exists swept_at timestamptz;

comment on column public.client_deliverables.swept_at is
  'F016e (AS-030 remediation): set the first time this deliverable caused sweep_overdue_blocking_deliverables to move its linked task into Blocked. Once set, this deliverable never triggers the sweep again -- a human moving the task back out of Blocked afterwards must stay out, not be re-blocked by the same overdue deliverable on the next hourly tick.';

create or replace function public.sweep_overdue_blocking_deliverables()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_blocked_count integer := 0;
begin
  for v_row in
    select distinct on (t.id)
      t.id as task_id,
      cd.id as deliverable_id,
      cd.title as deliverable_title,
      t.status as previous_status,
      ps_blocked.id as blocked_status_id,
      ps_blocked.name as blocked_status_name
    from client_deliverables cd
    join tasks t on t.id = cd.task_id
    join projects p on p.id = cd.project_id
    join lateral (
      select ps.id, ps.name
      from project_statuses ps
      where ps.project_id = cd.project_id
        and ps.client_bucket = 'blocked'
      order by ps.position asc
      limit 1
    ) ps_blocked on true
    where cd.blocking
      and cd.state not in ('accepted', 'waived')
      and cd.due_at is not null
      and cd.due_at < (now() at time zone 'utc')::date
      and cd.swept_at is null
      and t.deleted_at is null
      and p.deleted_at is null
      and t.status_id is distinct from ps_blocked.id
    order by t.id, cd.due_at asc, cd.position asc
  loop
    update tasks
       set status_id = v_row.blocked_status_id,
           status = v_row.blocked_status_name
     where id = v_row.task_id;

    -- Mark every one of THIS task's overdue, blocking, unswept
    -- deliverables as swept in the same pass -- not just the single
    -- "worst" row `distinct on (t.id)` happened to pick above -- so none
    -- of them can independently re-trigger the sweep on a later run
    -- once a human has moved the task back out.
    update client_deliverables
       set swept_at = now()
     where task_id = v_row.task_id
       and blocking
       and state not in ('accepted', 'waived')
       and due_at is not null
       and due_at < (now() at time zone 'utc')::date
       and swept_at is null;

    perform public.write_task_activity_entry(
      p_task_id => v_row.task_id,
      p_kind => 'field_changed',
      p_field => 'status',
      p_old_value => to_jsonb(v_row.previous_status),
      p_new_value => jsonb_build_object(
        'status', v_row.blocked_status_name,
        'reason', 'client_deliverable_overdue',
        'deliverable_id', v_row.deliverable_id,
        'deliverable_title', v_row.deliverable_title
      ),
      p_system => true
    );

    v_blocked_count := v_blocked_count + 1;
  end loop;

  return v_blocked_count;
end;
$$;

comment on function public.sweep_overdue_blocking_deliverables() is
  'F013/F016e (AS-030): hourly sweep moving a task into its project''s client_bucket = ''blocked'' column when a blocking client_deliverable linked to it is overdue and not yet accepted/waived. Only ever moves a task INTO blocked, never out; idempotent per task within a run, and per deliverable across runs via swept_at -- a deliverable that already caused one sweep never causes a second, even if a human later moves the task back out of Blocked.';
