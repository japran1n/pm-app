-- Makes bulkDeleteTasks atomic: soft-deletes the requested tasks and
-- cascades the soft-delete to their direct children in a single
-- transaction, so a mid-sequence failure can never leave children visible
-- on the board under a now-deleted parent.
create or replace function public.bulk_delete_tasks_atomic(
  p_task_ids   uuid[],
  p_deleted_by uuid,
  p_deleted_at timestamptz
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_ids uuid[];
begin
  -- Soft-delete the requested tasks and capture which ones were actually
  -- updated (excludes tasks already soft-deleted).
  with deleted as (
    update public.tasks
    set deleted_at = p_deleted_at,
        deleted_by = p_deleted_by
    where id = any(p_task_ids)
      and deleted_at is null
    returning id
  )
  select array_agg(id) into v_deleted_ids from deleted;

  -- Cascade soft-delete to direct children of the deleted tasks.
  if v_deleted_ids is not null and array_length(v_deleted_ids, 1) > 0 then
    update public.tasks
    set deleted_at = p_deleted_at,
        deleted_by = p_deleted_by
    where parent_task_id = any(v_deleted_ids)
      and deleted_at is null;
  end if;

  return coalesce(v_deleted_ids, '{}');
end;
$$;

revoke all on function public.bulk_delete_tasks_atomic(uuid[], uuid, timestamptz) from public;
grant execute on function public.bulk_delete_tasks_atomic(uuid[], uuid, timestamptz) to authenticated;
