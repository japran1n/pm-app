-- Atomically replaces a task's assignee set and recomputes the
-- `tasks.assignee_id` mirror column in a single transaction.
--
-- Previously (setTaskAssigneesCore in lib/actions/tasks.ts) this was three
-- separate round trips: DELETE removed assignees, INSERT new assignees,
-- then a follow-up read+update to recompute the mirror. If the INSERT
-- failed after the DELETE succeeded, all assignees could be silently
-- stripped from the task with no rollback. Wrapping the whole sequence in
-- a single plpgsql function makes it atomic: either the full desired set
-- (and its mirror) is applied, or nothing changes.
--
-- Mirror tie-break must match resolveMirrorAssigneeId's JS logic exactly:
-- earliest created_at, then lowest user_id as a stable tie-break.
create or replace function public.set_task_assignees_atomic(
  p_task_id      uuid,
  p_desired_user_ids uuid[],
  p_assigned_by  uuid
)
returns uuid   -- the new assignee_id mirror value (may be null)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mirror_id uuid;
begin
  -- Remove assignees not in the desired set
  delete from public.task_assignees
  where task_id = p_task_id
    and user_id <> all(p_desired_user_ids);

  -- Add new assignees (skip existing)
  insert into public.task_assignees (task_id, user_id, assigned_by)
  select p_task_id, u, p_assigned_by
  from unnest(p_desired_user_ids) as u
  on conflict (task_id, user_id) do nothing;

  -- Recompute mirror assignee_id (earliest created_at, then lowest
  -- user_id as a tie-break — matches resolveMirrorAssigneeId in
  -- lib/actions/tasks.ts).
  select user_id into v_mirror_id
  from public.task_assignees
  where task_id = p_task_id
  order by created_at, user_id
  limit 1;

  update public.tasks
  set assignee_id = v_mirror_id
  where id = p_task_id;

  return v_mirror_id;
end;
$$;

revoke all on function public.set_task_assignees_atomic(uuid, uuid[], uuid) from public;
grant execute on function public.set_task_assignees_atomic(uuid, uuid[], uuid) to authenticated;
