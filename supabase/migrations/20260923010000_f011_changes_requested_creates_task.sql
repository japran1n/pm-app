-- F011 (missions/20260903-portal, M2 — Approvals): a `changes_requested`
-- decision creates the work it implies (AS-025). Extends
-- `decide_approval_atomic` (20260916010000, hardened by 20260920010000)
-- rather than adding a second RPC — this is the one place a client's
-- decision is ever written, and the spec's own instruction is "in the
-- same transaction" as that decision, which a Postgres function body
-- already is (same reasoning every prior atomic RPC in this schema gives).
--
-- 1. `approval_requests.resulting_task_id`: the new task the decision
--    created, when it did. Nullable — an `approved` decision, or a
--    decision with no subject that yields a resulting task never sets
--    it. No trigger guards it against later mutation the way `state`
--    is guarded (20260916010000's prevent_approval_request_settled_
--    update trigger fires on OLD.state, not this column, and this
--    column is only ever written once, inside this same function, at
--    the moment the row is first settled).
--
-- 2. `decide_approval_atomic` gains, for `p_decision = 'changes_requested'`
--    only, in this order (spec's own numbered scope, plus this mission's
--    "comment first, then flags" carry-over from F024 of the prior
--    mission, applied here as "create the work and post the comment
--    before flipping any flag or settling the row"):
--
--      a. Resolve an insertion column for the new task: the project's
--         first `not_started`-category status by position, falling back
--         to the project's first status of any category by position.
--         Every project gets its four default statuses seeded by
--         `projects_seed_default_statuses` (20260824010000) at creation
--         and can never be emptied of its last one (`prevent_last_
--         project_status_delete`, 20260824020000), so this lookup is
--         guaranteed to find a row in practice — this is defensive, not
--         this feature's forced-failure path (see the handoff for the
--         path that actually is: `subject_id` carries no FK by design,
--         so a subject task that no longer exists by decision time is
--         the one write in this whole extension that can genuinely
--         fail).
--      b. Position: append to the end of that (project, status) column,
--         same `coalesce(max(position) + 1000, 1000)` shape
--         lib/board/position.ts's `calculatePosition` computes for an
--         empty-neighbor insert (DEFAULT_POSITION / BOUNDARY_GAP both
--         equal 1000 there) — no JS boundary to call from SQL, so the
--         arithmetic is inlined rather than a second, drifting
--         reimplementation of a different shape.
--      c. task_type_id: the subject task's own task_type_id when the
--         subject is a task, else null (this project has no "default
--         task type" concept anywhere else in the schema — see this
--         feature's handoff Autonomous decisions for why null, not a
--         new column, is the safe default here).
--      d. `client_visible = false` explicit (spec: "the team decides
--         what to show", not a default already-false column left
--         unstated).
--      e. `assignee_id` = the approval's `requested_by` (spec).
--      f. `description`: the client's note, verbatim, plus one
--         attribution/date line — never silently truncated or
--         paraphrased.
--      g. Insert a comment on the subject task with the same note, when
--         `subject_type = 'task'` — the F024 behaviour this mission's own
--         spec says people already rely on. A plain insert into
--         `comments` (no mention parsing / notification fan-out — this
--         function has no session to run the app-layer `addComment`
--         through, and the note is not client-input-from-a-composer,
--         it is the just-recorded decision note), same "administrative
--         insert bypassing RLS from inside a SECURITY DEFINER function"
--         shape every other atomic RPC in this schema already uses.
--      h. Only THEN: the existing state/decided_by/decided_at/
--         decision_note UPDATE, plus `resulting_task_id`, plus the
--         existing `tasks.pending_client_approval` clear — "flags".
--
--    A task-insert (or comment-insert) failure raises out of the
--    function before any of (h) runs, and Postgres rolls back the
--    entire function body (including nothing having been written yet)
--    — AS-025's failure case: the client must never see "changes
--    requested" recorded with no work created behind it.
--
--    `approved` decisions are entirely unaffected — the new block is
--    gated on `p_decision = 'changes_requested'` and sits after the
--    existing early-exit checks, before the existing UPDATE.

alter table approval_requests
  add column if not exists resulting_task_id uuid references tasks (id) on delete set null;

-- The RETURNS TABLE shape gains a column (resulting_task_id), which
-- Postgres will not let `create or replace function` do in place ("cannot
-- change return type of existing function" / "Row type defined by OUT
-- parameters is different") -- the existing function must be dropped
-- first, same as any other OUT-parameter-shape change.
drop function if exists public.decide_approval_atomic(uuid, text, text);

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

  -- F006l/B1: a client of a portal-disabled project must not be able to
  -- settle an approval directly against the RPC, bypassing the (already
  -- correctly gated) portal UI.
  if not public.is_project_portal_enabled(v_project_id) then
    raise exception 'decide_approval_atomic: you are not the decision owner for this request' using errcode = '42501';
  end if;

  -- AS-022: the actual enforcement point, independent of any UI state.
  select pdo.user_id into v_owner_id
    from project_decision_owners pdo
   where pdo.project_id = v_project_id
     and pdo.decision_type = v_decision_type;

  if v_owner_id is null or v_owner_id <> v_user_id then
    raise exception 'decide_approval_atomic: you are not the decision owner for this request' using errcode = '42501';
  end if;

  -- F011 (AS-025): a changes_requested decision creates the work it
  -- implies, before the decision itself is recorded (see this
  -- migration's header comment for the full ordering rationale).
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

    -- F024 of the prior mission: the client's note also lands as a
    -- comment on the subject task, when the subject is a task —
    -- inserted here, before the decision itself settles, mirroring the
    -- "comment first, then flags" order that mission fixed.
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
