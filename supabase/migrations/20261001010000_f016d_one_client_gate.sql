-- F016d (missions/20260903-portal, M3 remediation): one shared predicate
-- for every client-callable RPC, and a column guard on `client_requests`.
--
-- ---------------------------------------------------------------------
-- Defect 1 (AS-046) — `flag_assumption_atomic` checked client-ness,
-- project visibility and portal_enabled, and never `client_visible` —
-- the one gate `project_assumptions_select_client` applies
-- (20260926010000:355-364). Fifth occurrence of the same class in this
-- mission (F006b, F006i, F006k, F006l, F009b). Patching this one
-- instance again guarantees a sixth, because the gate has been a
-- checklist a human re-derives at every new call site, not a thing
-- anyone calls.
--
-- Fix: extract `public.client_gate(...)`, one predicate that
-- encapsulates the full set — active client membership, project
-- visibility, portal_enabled, and (when the caller passes the subject
-- row's own value) `client_visible` — and route every client-callable
-- RPC in this mission through it, passing flags for the subset each one
-- actually needs rather than reimplementing the parts it wants:
--
--   - flag_assumption_atomic          — full gate incl. client_visible
--   - mark_deliverable_delivered_atomic — portal gate, NOT client-only
--     (any active member may deliver on a client's behalf, per its own
--     20260928010000 header), no client_visible column on the table
--   - decide_approval_atomic          — portal gate only (decision
--     ownership, checked separately, is not restricted to clients —
--     see this file's own note below)
--   - assert_portal_task_actionable_by_client — full gate incl.
--     client_visible (unchanged shape, now sourced from one predicate
--     instead of four inline checks)
--   - accept_client_request_atomic    — portal gate only (this function
--     bars the client role outright; the portal_enabled check is the
--     one client-relevant gate left in it, since portal_enabled decides
--     whether the ORIGINATING client_requests row is still one a client
--     could see at all)
--   - send_change_request_quote_atomic — portal gate only, same shape
--     and same reasoning as accept_client_request_atomic; not named in
--     this feature's own scope list, but it shares
--     accept_client_request_atomic's exact preamble
--     (20260930010000's own header: "mirrors accept_client_request_
--     atomic's own membership + teamCanTriage + portal-enabled
--     preamble"), so leaving it on the old inline check while its twin
--     moves to the shared predicate would recreate the drift this
--     feature exists to close.
--
-- Two functions are deliberately NOT routed through client_gate, with
-- reasons named rather than a forced fit (per this feature's own
-- instruction):
--
--   - decide_approval_atomic's decision-owner check is
--     `is_project_decision_owner` (20260925010000/F009b), already a
--     single shared predicate with its own single call site pair
--     (decide_approval_atomic, assert_portal_task_actionable_by_client).
--     A decision owner is not necessarily a client (project_decision_
--     owners carries no role constraint — grep confirms no CHECK or FK
--     to the client role anywhere in 20260916010000), so folding it into
--     client_gate's client-role flag would be wrong, not merely
--     redundant. It stays its own predicate.
--   - send_change_request_quote_atomic and accept_client_request_atomic
--     both explicitly BAR the client role (`v_caller_role = 'client'`
--     raises in both). client_gate's `p_require_client_role` flag exists
--     to REQUIRE client-ness, not to forbid it — there is no boolean
--     flag that expresses "not a client" without a second, opposite-
--     meaning parameter that only two functions would ever pass `true`.
--     Both keep their own inline role-bar check (unchanged) and route
--     only their portal_enabled check through client_gate.
--
-- ---------------------------------------------------------------------
-- Defect 2 — F016 added fifteen columns to `client_requests` and zero
-- policy changes. `client_requests_update_author_while_submitted`
-- (20260918010000:111-127) pins `converted_task_id` and `reviewed_by` in
-- its WITH CHECK but says nothing about `scope_verdict`, `quoted_hours`,
-- `quoted_amount`, `quote_currency`, `quote_note`, `quote_valid_until`,
-- `client_decision`, `decided_by`, `decided_at`, `track`,
-- `track_overridden`, `track_override_reason` or `approval_request_id` —
-- all twelve are writable by the row's own author while status =
-- 'submitted'. RLS's WITH CHECK is a row-level (not column-level)
-- mechanism, so a policy cannot pin individual columns to their OLD
-- values; F006k's `enforce_project_portal_and_launch_field_role`
-- (20260919010000) is this schema's own precedent for the alternative —
-- a BEFORE UPDATE trigger that compares NEW/OLD column-by-column and
-- raises when a guarded one changed. Followed here.
--
-- `kind` and `severity` are left writable by the author: `kind` is the
-- client's own triage bucket (bug/change/new_work/question, F016's own
-- comment on the column), and `severity` is the client's own claim about
-- how bad it is — the client authoring their own request's `title` and
-- `body` today already carries the same "we trust the author's own
-- account of their problem" shape; team-authoritative once triage
-- starts is the `reviewed_by`/`scope_verdict is not null` question below,
-- not before.
--
-- Every other column added by F016 is either the outcome of the team's
-- own triage (`scope_verdict`, every `quote_*` column, `track`,
-- `track_overridden`, `track_override_reason`, `approval_request_id`) or
-- a mirror of the client's decision on `approval_requests`, written only
-- by `client_requests_sync_decision_from_approval` (`client_decision`,
-- `decided_by`, `decided_at` — 20260930010000's own column comment: "never
-- written directly by any client-facing write path"). All twelve are
-- guarded.
--
-- Checked against every table this mission has added columns to since
-- F006k's sweep (20260919010000), per this feature's own scope 2
-- instruction — `grep -n "add column" supabase/migrations/*.sql` for
-- everything after that migration's timestamp:
--
--   - approval_requests.resulting_task_id (20260923010000/F011): no
--     client INSERT or UPDATE policy exists on approval_requests at all
--     (`grep -n "create policy" 20260916010000_approval_requests.sql`
--     shows only `_select_team`, `_select_client`, `_insert_team`,
--     `_update_team` — no `client` in any INSERT/UPDATE policy name or
--     body). A client cannot reach this column through PostgREST by any
--     path; nothing to guard.
--   - client_requests.* (F016, this file's Defect 2): guarded below.
--   - client_deliverables / project_scope_items / project_decisions /
--     project_assumptions (20260926010000/F012): that migration's own
--     header states "No table gets an INSERT/UPDATE/DELETE policy for
--     the client role at all" — confirmed, `grep -n "create policy"
--     20260926010000_deliverables_scope_decisions_assumptions.sql` shows
--     only team-writer policies plus the four client SELECT policies.
--     Nothing to guard.
--   - client_deliverables.task_id / .phase_id composite FKs
--     (20260930020000/F016c): a constraint addition, not a client-
--     writable column; same "no client write policy" table as above.

-- ---------------------------------------------------------------------
-- 1. The shared predicate
-- ---------------------------------------------------------------------

create or replace function public.client_gate(
  p_project_id uuid,
  p_client_visible boolean default true,
  p_require_client_role boolean default true,
  p_require_project_visible boolean default true,
  p_require_portal_enabled boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (not p_require_client_role or public.is_project_client(p_project_id))
    and (not p_require_project_visible or public.is_project_visible_to(p_project_id))
    and (not p_require_portal_enabled or public.is_project_portal_enabled(p_project_id))
    and coalesce(p_client_visible, false);
$$;

comment on function public.client_gate(uuid, boolean, boolean, boolean, boolean) is
  'F016d: the one predicate every client-callable RPC in this schema must route through. p_client_visible defaults to true ("not applicable to this table"); a caller that has a subject row with its own client_visible column must pass that column''s real value, never the default, or the one gate this predicate exists to stop being forgotten gets forgotten again.';

revoke all on function public.client_gate(uuid, boolean, boolean, boolean, boolean) from public;
grant execute on function public.client_gate(uuid, boolean, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. flag_assumption_atomic — AS-046. Now selects `client_visible` and
-- routes the whole gate (client-ness, visibility, portal_enabled,
-- client_visible) through client_gate. Same rejection message/errcode
-- ('assumption not found', 'P0002') on every branch, unchanged — the
-- oracle-neutrality this function already had is preserved, only the
-- check that decides it is different.
-- ---------------------------------------------------------------------

create or replace function public.flag_assumption_atomic(
  p_assumption_id uuid,
  p_note text
)
returns table (assumption_id uuid, flagged_by_client_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_text text;
  v_state text;
  v_client_visible boolean;
  v_flagged_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'flag_assumption_atomic: not authenticated' using errcode = '28000';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'flag_assumption_atomic: a note is required' using errcode = '22023';
  end if;

  select pa.project_id, pa.text, pa.state, pa.client_visible
    into v_project_id, v_text, v_state, v_client_visible
    from project_assumptions pa
   where pa.id = p_assumption_id
     for update of pa;

  if v_project_id is null then
    raise exception 'flag_assumption_atomic: assumption not found' using errcode = 'P0002';
  end if;

  if not public.is_project_client(v_project_id) then
    raise exception 'flag_assumption_atomic: only a client of this project may flag an assumption' using errcode = '42501';
  end if;

  -- F016d/AS-046: one call, full gate — was three checks (visibility,
  -- portal_enabled) that had silently dropped the fourth
  -- (client_visible) the SELECT policy applies. The role check above
  -- stays separate (deliberately) because it raises its own distinct
  -- '42501' message rather than the generic 'not found' oracle every
  -- other branch here uses -- collapsing it into client_gate would lose
  -- that distinction for no gain, since client_gate returns only a
  -- boolean.
  if not public.client_gate(v_project_id, v_client_visible) then
    raise exception 'flag_assumption_atomic: assumption not found' using errcode = 'P0002';
  end if;

  select p.workspace_id into v_workspace_id from projects p where p.id = v_project_id;
  if v_workspace_id is null then
    raise exception 'flag_assumption_atomic: project not found' using errcode = 'P0002';
  end if;

  update project_assumptions
     set flagged_by_client_at = v_flagged_at,
         flagged_note = p_note
   where id = p_assumption_id;

  perform public.write_audit_log_entry(
    v_workspace_id,
    'project_assumption.flagged_by_client',
    'project_assumption',
    p_assumption_id,
    jsonb_build_object('project_id', v_project_id, 'note', p_note)
  );

  perform public.create_notification(
    p_user_id => wm.user_id,
    p_workspace_id => v_workspace_id,
    p_kind => 'assumption_flagged',
    p_actor_id => v_user_id,
    p_task_id => null,
    p_comment_id => null,
    p_payload => jsonb_build_object(
      'assumption_id', p_assumption_id,
      'project_id', v_project_id,
      'text', v_text,
      'note', p_note
    )
  )
  from workspace_members wm
  where wm.workspace_id = v_workspace_id
    and wm.status = 'active'
    and wm.role not in ('viewer', 'client');

  return query select p_assumption_id, v_flagged_at;
end;
$$;

revoke all on function public.flag_assumption_atomic(uuid, text) from public;
grant execute on function public.flag_assumption_atomic(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. mark_deliverable_delivered_atomic — any active member the project
-- is visible to (team included, per its own 20260928010000 header), so
-- p_require_client_role := false. client_deliverables has no
-- client_visible column (20260926010000's own header: "no client_visible
-- column of their own"), so p_client_visible is left at its default
-- (true = not applicable).
-- ---------------------------------------------------------------------

create or replace function public.mark_deliverable_delivered_atomic(
  p_deliverable_id uuid
)
returns table (deliverable_id uuid, state text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_state text;
begin
  if v_user_id is null then
    raise exception 'mark_deliverable_delivered_atomic: not authenticated' using errcode = '28000';
  end if;

  select cd.project_id, cd.state
    into v_project_id, v_state
    from client_deliverables cd
   where cd.id = p_deliverable_id
     for update of cd;

  if v_project_id is null then
    raise exception 'mark_deliverable_delivered_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if not public.client_gate(v_project_id, p_require_client_role => false) then
    raise exception 'mark_deliverable_delivered_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if v_state in ('accepted', 'waived') then
    raise exception 'mark_deliverable_delivered_atomic: this item has already been accepted' using errcode = '42501';
  end if;

  update client_deliverables
     set state = 'delivered',
         delivered_at = now(),
         review_note = null
   where id = p_deliverable_id;

  return query select p_deliverable_id, 'delivered'::text;
end;
$$;

revoke all on function public.mark_deliverable_delivered_atomic(uuid) from public;
grant execute on function public.mark_deliverable_delivered_atomic(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. decide_approval_atomic — the portal_enabled check only. Decision
-- ownership stays on `is_project_decision_owner` (F009b's own shared
-- predicate, not folded in here -- see this file's header).
-- ---------------------------------------------------------------------

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

  -- F016d: portal_enabled routed through client_gate, both other flags
  -- turned off -- decision ownership is not client-restricted and is
  -- checked separately below via is_project_decision_owner.
  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'decide_approval_atomic: you are not the decision owner for this request' using errcode = '42501';
  end if;

  if not public.is_project_decision_owner(v_project_id, v_decision_type, v_user_id) then
    raise exception 'decide_approval_atomic: you are not the decision owner for this request' using errcode = '42501';
  end if;

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
-- 5. assert_portal_task_actionable_by_client — full gate incl.
-- client_visible, now sourced from client_gate. The decision-owner check
-- (F009b) stays separate, same reasoning as decide_approval_atomic
-- above.
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

  -- F016d: visibility, portal_enabled and client_visible, one call.
  if not public.client_gate(v_project_id, v_client_visible, p_require_client_role => false) then
    raise exception 'task not found';
  end if;

  if not v_pending then
    raise exception 'task not found';
  end if;

  if not public.is_project_decision_owner(v_project_id, null, v_user_id) then
    raise exception 'task not found';
  end if;

  return query select p_task_id, v_project_id;
end;
$$;

revoke all on function public.assert_portal_task_actionable_by_client(uuid) from public;

-- ---------------------------------------------------------------------
-- 6. accept_client_request_atomic — portal_enabled only (see this
-- file's header for why client-ness is not routed through client_gate
-- here).
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

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

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

-- ---------------------------------------------------------------------
-- 7. send_change_request_quote_atomic — portal_enabled only, same shape
-- as accept_client_request_atomic (see this file's header).
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

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if p_scope_verdict = 'change_request' and (p_quoted_amount is null or p_quote_valid_until is null) then
    raise exception 'a change request quote needs an amount and a validity date'
      using errcode = '22023';
  end if;

  -- F016d: a transaction-local trust flag, not a role exemption -- see
  -- this file's Defect 2 header. This function writes exactly the
  -- columns the guard trigger pins, as the caller's own authenticated
  -- session (a team member, but the guard trigger cannot assume that;
  -- see the header), so it must announce itself as trusted for the
  -- duration of its own UPDATE only.
  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

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

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

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
-- 8. Defect 2 — pin the twelve team-triage/quote-decision columns on
-- `client_requests` to their OLD values in a BEFORE UPDATE trigger,
-- following F006k's `enforce_project_portal_and_launch_field_role`
-- shape (20260919010000). Fires only on the author-while-submitted path
-- in practice (the team policy has no such restriction and legitimately
-- writes these columns), but is written to guard the columns
-- unconditionally rather than only "when the author is the one writing"
-- -- an author can never legitimately change these regardless of which
-- policy let the UPDATE through, and a single always-on trigger is one
-- fewer thing to keep in sync with which RLS policy currently applies.
-- F006k's own exemption is `auth.role() = 'service_role'`, which does
-- NOT fit here: both legitimate writers of these columns
-- (send_change_request_quote_atomic, the team's triage RPC, and
-- client_requests_sync_decision_from_approval, the trigger that mirrors
-- a client's own decision back from approval_requests) run as
-- SECURITY DEFINER under the caller's OWN authenticated session --
-- often the request's own author, when that author is also the client
-- deciding the quote decide_approval_atomic just settled. `auth.uid()`
-- is unchanged by SECURITY DEFINER (it reads the JWT, not the
-- function's privilege level), so a service_role-only exemption would
-- leave both of those legitimate writers indistinguishable from a
-- direct author PATCH and block AS-047's own decision-sync path.
--
-- Fixed with a transaction-local trust flag (`set_config(...,
-- is_local => true)`), the standard Postgres pattern for "this specific,
-- named, already-privileged caller is trusted to bypass a row trigger"
-- when the caller is a SECURITY DEFINER function running as the
-- ordinary authenticated user, not a distinguishable role. `is_local =>
-- true` scopes the flag to the current transaction only -- it can never
-- leak into a later, unrelated request -- and both writers reset it to
-- 'off' immediately after their own UPDATE, so no other statement in the
-- same transaction inherits the bypass either. Nothing outside those two
-- functions ever sets this flag, so a direct PostgREST PATCH -- which
-- runs in its own transaction and never sets it -- is unaffected.
-- ---------------------------------------------------------------------

-- F016d: `client_requests_sync_decision_from_approval` (20260930010000,
-- unchanged in every other respect) is this table's OTHER legitimate
-- writer of a guarded column (`client_decision`, `decided_by`,
-- `decided_at`) and runs under the same "SECURITY DEFINER as the
-- caller's own session" shape as send_change_request_quote_atomic --
-- same bypass flag, same reasoning, see this file's Defect 2 header.
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
    return NEW;
  end if;

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

create or replace function public.enforce_client_requests_triage_columns_immutable_by_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if coalesce(current_setting('app.client_requests_triage_guard_bypass', true), 'off') = 'on' then
    return new;
  end if;

  if (
    new.scope_verdict is distinct from old.scope_verdict
    or new.quoted_hours is distinct from old.quoted_hours
    or new.quoted_amount is distinct from old.quoted_amount
    or new.quote_currency is distinct from old.quote_currency
    or new.quote_note is distinct from old.quote_note
    or new.quote_valid_until is distinct from old.quote_valid_until
    or new.client_decision is distinct from old.client_decision
    or new.decided_by is distinct from old.decided_by
    or new.decided_at is distinct from old.decided_at
    or new.track is distinct from old.track
    or new.track_overridden is distinct from old.track_overridden
    or new.track_override_reason is distinct from old.track_override_reason
    or new.approval_request_id is distinct from old.approval_request_id
  ) then
    if new.created_by = auth.uid() then
      raise exception 'client_requests: the request''s own author cannot change its triage, quote or decision fields'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists client_requests_enforce_triage_columns_immutable_by_author on public.client_requests;
create trigger client_requests_enforce_triage_columns_immutable_by_author
  before update on public.client_requests
  for each row
  execute function public.enforce_client_requests_triage_columns_immutable_by_author();
