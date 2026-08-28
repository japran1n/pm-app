-- Atomically copies a source task's checklist items and assignees onto a
-- newly-inserted duplicate task.
--
-- Previously (duplicateTask in lib/actions/tasks.ts) this was two separate
-- round trips after the new task row was inserted: an INSERT into
-- checklist_items, then an INSERT into task_assignees. Either insert could
-- fail independently, and failures were only logged — the function still
-- returned ok:true, leaving an orphan task on the board missing its
-- checklist and/or assignees with no indication to the caller. Wrapping
-- both copies in a single plpgsql function makes them atomic: either both
-- copies succeed, or the whole RPC call fails and the caller can roll back
-- the task insert itself.
create or replace function public.duplicate_task_atomic(
  p_source_task_id uuid,
  p_new_task_id    uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Copy checklist items (same content, same position).
  insert into public.checklist_items (task_id, content, position)
  select p_new_task_id, content, position
  from public.checklist_items
  where task_id = p_source_task_id;

  -- Copy assignees, preserving each source row's assigned_by.
  insert into public.task_assignees (task_id, user_id, assigned_by)
  select p_new_task_id, user_id, assigned_by
  from public.task_assignees
  where task_id = p_source_task_id;
end;
$$;

revoke all on function public.duplicate_task_atomic(uuid, uuid) from public;
grant execute on function public.duplicate_task_atomic(uuid, uuid) to authenticated;
