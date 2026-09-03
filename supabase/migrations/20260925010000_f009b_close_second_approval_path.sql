-- F009b (missions/20260903-portal, M2 remediation — B2/F-1/F-2 from
-- M2-scrutiny.md): close the second, ungated client decision path and
-- add the two database-layer validations the same gate found missing.
--
-- ---------------------------------------------------------------------
-- Part 1 — B2: "two functions that must agree forever" is exactly the
-- shape this mission keeps getting caught by (F009's own deviation, the
-- three RLS sweeps, the M1 status vocabulary). Both existing decision
-- paths ALREADY delegate their gate to one shared helper each:
--   - decide_approval_atomic (20260916010000, since hardened) is its own
--     single call site for the `approval_requests` flow.
--   - approve_portal_task_atomic and request_portal_task_changes_atomic
--     (20260906010000) both delegate their entire authorisation check to
--     `assert_portal_task_actionable_by_client` — one helper, two
--     callers, already established before this migration (confirmed:
--     `grep assert_portal_task_actionable_by_client
--     supabase/migrations/20260906010000_portal_task_actions_project_
--     visibility.sql` shows both RPC bodies calling it and nothing else
--     checking authorisation in either body).
--
-- So the fix that keeps the TWO SURFACES (Approvals view vs. task page)
-- in agreement forever is not "route the task page through
-- decide_approval_atomic" — the task page's legacy toggle
-- (`tasks.pending_client_approval`, flipped directly by the team via
-- `lib/actions/client-visibility.ts`, confirmed by grep: it never creates
-- an `approval_requests` row) carries no `decision_type` and no
-- `approval_requests.id` to pass as `p_request_id`. There is no request
-- to decide. Forcing one into existence here would be a second, larger
-- feature (retiring the boolean flow entirely, which F009's own plan
-- entry gestured at but this feature's scope does not authorise — the
-- clarified spec's "Definition of done" requires the legacy toggle keep
-- working, not be replaced).
--
-- Instead: extract the actual comparison BOTH gates need to make --
-- "is this user a decision owner on this project" -- into one new SQL
-- function, `is_project_decision_owner`, and call it from both
-- `decide_approval_atomic` (with the request's own specific
-- `decision_type`) and `assert_portal_task_actionable_by_client` (with
-- `p_decision_type := null`, meaning "owns at least one decision type on
-- this project" -- the closest database-checkable analogue of "named
-- decision owner" for a flag that was never raised against a specific
-- decision type in the first place, and the exact shape of the reported
-- defect: "a client who owns no decision type" succeeds on one surface
-- and not the other). Two call sites, one predicate, changed together —
-- the shape design constraint #6 and this migration's own header both
-- ask for.
-- ---------------------------------------------------------------------

create or replace function public.is_project_decision_owner(
  p_project_id uuid,
  p_decision_type text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_decision_type is null then exists (
      select 1
        from project_decision_owners pdo
       where pdo.project_id = p_project_id
         and pdo.user_id = p_user_id
    )
    else exists (
      select 1
        from project_decision_owners pdo
       where pdo.project_id = p_project_id
         and pdo.decision_type = p_decision_type
         and pdo.user_id = p_user_id
    )
  end;
$$;

revoke all on function public.is_project_decision_owner(uuid, text, uuid) from public;
grant execute on function public.is_project_decision_owner(uuid, text, uuid) to authenticated;

-- decide_approval_atomic: swap the inline owner lookup for the shared
-- helper. No behaviour change for this function's own callers -- same
-- comparison, same errcode, same message -- this is purely "one place
-- both functions read the rule from" rather than a second inline copy.
create or replace function public.decide_approval_atomic(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns table (
  request_id uuid,
  state text,
  decided_at timestamptz,
  resulting_task_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_decision_type text;
  v_subject_type text;
  v_subject_id uuid;
  v_state text;
  v_requested_by uuid;
  v_title text;
  v_phase_id uuid;
  v_owner_id uuid;
  v_decided_at timestamptz := now();
  v_task_project_id uuid;
  v_notify_task_id uuid;
  v_resulting_task_id uuid;
  v_status text;
  v_next_position double precision;
  v_task_type_id uuid;
  v_description text;
  v_decider_name text;
  v_subject_project_id uuid;
begin
  if v_user_id is null then
    raise exception 'decide_approval_atomic: not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'decide_approval_atomic: invalid decision %', p_decision using errcode = '22023';
  end if;

  if p_decision = 'changes_requested' and (p_note is null or btrim(p_note) = '') then
    raise exception 'decide_approval_atomic: a note is required when requesting changes' using errcode = '22023';
  end if;

  select ar.project_id, ar.decision_type, ar.subject_type, ar.subject_id,
         ar.state, ar.requested_by, ar.title, ar.phase_id
    into v_project_id, v_decision_type, v_subject_type, v_subject_id,
         v_state, v_requested_by, v_title, v_phase_id
    from approval_requests ar
   where ar.id = p_request_id
     for update of ar;

  if v_project_id is null then
    raise exception 'decide_approval_atomic: approval request not found' using errcode = 'P0002';
  end if;

  if v_state <> 'pending' then
    raise exception 'decide_approval_atomic: this request has already been decided' using errcode = '42501';
  end if;

  select p.workspace_id into v_workspace_id from projects p where p.id = v_project_id;
  if v_workspace_id is null then
    raise exception 'decide_approval_atomic: project not found' using errcode = 'P0002';
  end if;

  -- F009b (M2 remediation, F-1): `subject_id` carries no FK
  -- (20260916010000's own table comment) and no CHECK beyond null-ness,
  -- so a mismatched subject is a schema-legal row -- validated here, in
  -- the database, before this SECURITY DEFINER function touches the
  -- subject at all, rather than trusting the Zod validation in
  -- lib/validation/approvals.ts (not an authorisation boundary) or the
  -- caller-side check in requestApproval (lib/actions/approvals.ts,
  -- application code, bypassable by a raw PostgREST insert against
  -- approval_requests). Raises rather than silently skipping the
  -- subject-touching side effects, since a mismatched subject means the
  -- row is malformed, not merely "has no subject".
  if v_subject_type = 'task' and v_subject_id is not null then
    select t.project_id into v_subject_project_id from tasks t where t.id = v_subject_id;
    if v_subject_project_id is distinct from v_project_id then
      raise exception 'decide_approval_atomic: approval request not found' using errcode = 'P0002';
    end if;
  elsif v_subject_type = 'doc' and v_subject_id is not null then
    select d.project_id into v_subject_project_id from docs d where d.id = v_subject_id;
    if v_subject_project_id is distinct from v_project_id then
      raise exception 'decide_approval_atomic: approval request not found' using errcode = 'P0002';
    end if;
  elsif v_subject_type = 'phase' and v_subject_id is not null then
    select pp.project_id into v_subject_project_id from project_phases pp where pp.id = v_subject_id;
    if v_subject_project_id is distinct from v_project_id then
      raise exception 'decide_approval_atomic: approval request not found' using errcode = 'P0002';
    end if;
  end if;

  -- F006l/B1: a client of a portal-disabled project must not be able to
  -- settle an approval directly against the RPC, bypassing the (already
  -- correctly gated) portal UI.
  if not public.is_project_portal_enabled(v_project_id) then
    raise exception 'decide_approval_atomic: you are not the decision owner for this request' using errcode = '42501';
  end if;

  -- AS-022: the actual enforcement point, independent of any UI state.
  -- F009b: now reads the shared predicate rather than an inline lookup
  -- (see this migration's header).
  if not public.is_project_decision_owner(v_project_id, v_decision_type, v_user_id) then
    raise exception 'decide_approval_atomic: you are not the decision owner for this request' using errcode = '42501';
  end if;

  -- F011 (AS-025): a changes_requested decision creates the work it
  -- implies, before the decision itself is recorded (see
  -- 20260923010000's header comment for the full ordering rationale).
  if p_decision = 'changes_requested' then
    select ps.name into v_status
      from project_statuses ps
     where ps.project_id = v_project_id
       and ps.category = 'not_started'
     order by ps.position
     limit 1;

    if v_status is null then
      select ps.name into v_status
        from project_statuses ps
       where ps.project_id = v_project_id
       order by ps.position
       limit 1;
    end if;

    select coalesce(max(t.position) + 1000, 1000) into v_next_position
      from tasks t
     where t.project_id = v_project_id
       and t.status = v_status
       and t.deleted_at is null;

    v_task_type_id := null;
    if v_subject_type = 'task' and v_subject_id is not null then
      select t.task_type_id into v_task_type_id from tasks t where t.id = v_subject_id;
    end if;

    select p.display_name into v_decider_name from profiles p where p.id = v_user_id;

    v_description := p_note
      || E'\n\n— requested by ' || coalesce(v_decider_name, 'the client')
      || ' on ' || to_char(v_decided_at, 'YYYY-MM-DD');

    insert into tasks (
      project_id, phase_id, title, description, status, task_type_id,
      assignee_id, author_id, position, client_visible
    ) values (
      v_project_id, v_phase_id, 'Changes requested: ' || v_title, v_description,
      v_status, v_task_type_id, v_requested_by, v_user_id, v_next_position, false
    )
    returning id into v_resulting_task_id;

    if v_subject_type = 'task' and v_subject_id is not null then
      insert into comments (task_id, user_id, text)
      values (v_subject_id, v_user_id, 'Requested changes: ' || p_note);
    end if;
  end if;

  update approval_requests
     set state = p_decision,
         decided_by = v_user_id,
         decided_at = v_decided_at,
         decision_note = p_note,
         resulting_task_id = v_resulting_task_id
   where id = p_request_id;

  v_notify_task_id := null;
  if v_subject_type = 'task' and v_subject_id is not null then
    update tasks
       set pending_client_approval = false
     where id = v_subject_id;

    select t.project_id into v_task_project_id from tasks t where t.id = v_subject_id;
    if v_task_project_id = v_project_id then
      v_notify_task_id := v_subject_id;
    end if;
  end if;

  perform public.write_audit_log_entry(
    v_workspace_id,
    case when p_decision = 'approved' then 'approval_request.approved' else 'approval_request.changes_requested' end,
    'approval_request',
    p_request_id,
    jsonb_build_object(
      'decision_type', v_decision_type,
      'subject_type', v_subject_type,
      'subject_id', v_subject_id,
      'note', p_note,
      'resulting_task_id', v_resulting_task_id
    )
  );

  perform public.create_notification(
    p_user_id => v_requested_by,
    p_workspace_id => v_workspace_id,
    p_kind => 'approval_decided',
    p_actor_id => v_user_id,
    p_task_id => v_notify_task_id,
    p_comment_id => null,
    p_payload => jsonb_build_object(
      'request_id', p_request_id,
      'title', v_title,
      'decision', p_decision,
      'decision_type', v_decision_type,
      'resulting_task_id', v_resulting_task_id
    )
  );

  return query select p_request_id, p_decision, v_decided_at, v_resulting_task_id;
end;
$$;

revoke all on function public.decide_approval_atomic(uuid, text, text) from public;
grant execute on function public.decide_approval_atomic(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- assert_portal_task_actionable_by_client: the one shared gate for
-- approve_portal_task_atomic and request_portal_task_changes_atomic
-- (20260906010000's own header). Add the missing decision-owner check --
-- "owns at least one decision type on this project" (p_decision_type :=
-- null), since the legacy `pending_client_approval` boolean this helper
-- guards was never raised against a specific decision type. Same
-- "task not found" oracle as every other rejection branch in this
-- function, so "portal off", "not pending" and "owns nothing" all remain
-- indistinguishable to the caller.
-- ---------------------------------------------------------------------

create or replace function public.assert_portal_task_actionable_by_client(
  p_task_id uuid
)
returns table (task_id uuid, project_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_client_visible boolean;
  v_pending boolean;
  v_deleted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select t.project_id, p.workspace_id, t.client_visible, t.pending_client_approval, t.deleted_at
    into v_project_id, v_workspace_id, v_client_visible, v_pending, v_deleted_at
    from tasks t
    join projects p on p.id = t.project_id
   where t.id = p_task_id
     for update of t;

  if v_project_id is null or v_deleted_at is not null then
    raise exception 'task not found';
  end if;

  if not exists (
    select 1
      from workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = v_user_id
       and wm.status = 'active'
       and wm.role = 'client'
  ) then
    raise exception 'task not found';
  end if;

  if not public.is_project_visible_to(v_project_id) then
    raise exception 'task not found';
  end if;

  if not public.is_project_portal_enabled(v_project_id) then
    raise exception 'task not found';
  end if;

  if not v_client_visible or not v_pending then
    raise exception 'task not found';
  end if;

  -- F009b (M2 remediation, B2): AS-022's actual bug -- a client who owns
  -- no decision type on this project succeeded here while the Approvals
  -- view correctly refused the same caller with 42501. Closed by the
  -- same predicate `decide_approval_atomic` uses, applied with
  -- `p_decision_type := null` ("owns at least one decision type"),
  -- since the legacy toggle this function guards carries no decision
  -- type of its own.
  if not public.is_project_decision_owner(v_project_id, null, v_user_id) then
    raise exception 'task not found';
  end if;

  return query select p_task_id, v_project_id;
end;
$$;

revoke all on function public.assert_portal_task_actionable_by_client(uuid) from public;
