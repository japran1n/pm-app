-- F006l (missions/20260903-portal): close the four paths that never reach
-- RLS, found by the third M1 re-scrutiny
-- (missions/20260903-portal/milestones/M1-scrutiny-3.md, B1-B4). Three
-- prior sweeps (F006b/F006i/F006k) closed the `portal_enabled` gate at
-- the RLS layer; the policy matrix is clean. Every gap left is in code
-- that consults no policy at all: `SECURITY DEFINER` RPCs and Server
-- Actions on the service-role client.
--
-- This migration fixes the two SQL-layer holes (B1, B2). The two
-- application-layer holes (B3 addComment / B4 getAttachmentSignedUrl)
-- are fixed in lib/actions/comments.ts and lib/actions/attachments.ts in
-- the same commit.

-- ---------------------------------------------------------------------
-- B1 — decide_approval_atomic: add the portal gate alongside the
-- existing decision-owner check, following the shape F006i applied to
-- assert_portal_task_actionable_by_client
-- (20260918010000_f006i_authz_round_2.sql). Re-uses
-- is_project_portal_enabled (20260909010000) rather than inlining the
-- subquery a fifth time, per this feature's own scope instruction.
-- ---------------------------------------------------------------------

create or replace function public.decide_approval_atomic(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns table (
  request_id uuid,
  state text,
  decided_at timestamptz
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
  v_owner_id uuid;
  v_decided_at timestamptz := now();
  v_task_project_id uuid;
  v_notify_task_id uuid;
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
         ar.state, ar.requested_by, ar.title
    into v_project_id, v_decision_type, v_subject_type, v_subject_id,
         v_state, v_requested_by, v_title
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
  -- correctly gated) portal UI. Same oracle-neutral errcode as the
  -- decision-owner check immediately below, so "portal off" is
  -- indistinguishable from "not the decision owner" to the caller.
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

  update approval_requests
     set state = p_decision,
         decided_by = v_user_id,
         decided_at = v_decided_at,
         decision_note = p_note
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
      'note', p_note
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
      'decision_type', v_decision_type
    )
  );

  return query select p_request_id, p_decision, v_decided_at;
end;
$$;

revoke all on function public.decide_approval_atomic(uuid, text, text) from public;
grant execute on function public.decide_approval_atomic(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- B2 — get_open_task_counts: was SECURITY DEFINER with no authorisation
-- check of any kind and no `revoke ... from public`, so EXECUTE defaulted
-- to PUBLIC (anon included). Rewritten to: require an authenticated
-- caller, restrict to projects the caller can actually see
-- (is_active_workspace_member + is_project_visible_to, the same pair
-- every other project-scoped predicate in this schema uses), and for a
-- client caller additionally require the project's portal to be enabled
-- and count only client_visible tasks -- the same shape RLS enforces for
-- every other client-reachable task read (is_task_visible_to).
--
-- pg_temp is pinned (`public, pg_temp`), matching 20260908010000's fix
-- applied to every other SECURITY DEFINER predicate in this schema.
-- ---------------------------------------------------------------------

create or replace function public.get_open_task_counts(project_ids uuid[])
returns table (project_id uuid, open_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return;
  end if;

  return query
  select t.project_id, count(*)::bigint as open_count
  from tasks t
  join project_statuses ps on ps.id = t.status_id
  join projects p on p.id = t.project_id
  where t.project_id = any(project_ids)
    and t.deleted_at is null
    and ps.category != 'done'
    and public.is_active_workspace_member(p.workspace_id)
    and (
      -- Client caller: the portal's own rule -- portal enabled AND the
      -- task itself is client_visible. `is_project_visible_to` does not
      -- apply here at all (it excludes the client role by design, see
      -- 20260908010000/20260902010000), so it must not gate this branch.
      (
        public.is_project_client(t.project_id)
        and public.is_project_portal_enabled(t.project_id)
        and t.client_visible
      )
      -- Team/non-client caller: ordinary project visibility, same
      -- predicate every other project-scoped read in this schema uses.
      or (
        not public.is_project_client(t.project_id)
        and public.is_project_visible_to(t.project_id)
      )
    )
  group by t.project_id;
end;
$$;

revoke all on function public.get_open_task_counts(uuid[]) from public;
grant execute on function public.get_open_task_counts(uuid[]) to authenticated;
