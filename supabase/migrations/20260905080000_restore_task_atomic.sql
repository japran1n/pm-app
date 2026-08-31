-- Makes restoreTask atomic: restores the requested (soft-deleted) task and
-- cascades the restore to its own cascade-deleted children (those whose
-- deleted_via_task_id points back to this task) in a single transaction,
-- so a mid-sequence failure can never leave a child still marked deleted
-- under a now-restored, live-looking parent (or vice versa).
--
-- Status/position resolution mirrors restoreTask's prior JS-side logic
-- exactly:
--   - status: if the row's current status isn't one of the four known
--     board statuses, it's reset to 'todo' (KNOWN_STATUSES fallback).
--   - position: always appended to the end of the resolved (project,
--     status) column among currently LIVE tasks (deleted_at is null) —
--     restoreTask never inserts a restored task/child anywhere but the
--     bottom of its column, so calculatePosition's general two-neighbor
--     logic collapses to `coalesce(last_position, 0) + 1000`
--     (DEFAULT_POSITION and BOUNDARY_GAP are both 1000, see
--     lib/board/position.ts).
create or replace function public.restore_task_atomic(
  p_task_id uuid
)
returns table (
  id uuid,
  project_id uuid,
  status text,
  "position" float8,
  status_was_reset boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_current_status text;
  v_resolved_status text;
  v_status_was_reset boolean;
  v_last_position float8;
  v_new_position float8;
  v_known_statuses text[] := array['todo', 'in_progress', 'in_review', 'done'];
  v_child record;
  v_child_resolved_status text;
  v_child_last_position float8;
  v_child_position float8;
begin
  -- Lock and re-read the target row inside this transaction; only a
  -- currently soft-deleted task is eligible (mirrors the caller's own
  -- eligibility check, re-verified here against live state).
  select t.project_id, t.status
    into v_project_id, v_current_status
  from public.tasks t
  where t.id = p_task_id
    and t.deleted_at is not null
  for update;

  if v_project_id is null then
    return;
  end if;

  v_status_was_reset := not (v_current_status = any(v_known_statuses));
  v_resolved_status := case when v_status_was_reset then 'todo' else v_current_status end;

  select t."position"
    into v_last_position
  from public.tasks t
  where t.project_id = v_project_id
    and t.status = v_resolved_status
    and t.deleted_at is null
  order by t."position" desc
  limit 1;

  v_new_position := coalesce(v_last_position, 0) + 1000;

  update public.tasks
  set deleted_at = null,
      deleted_by = null,
      status = v_resolved_status,
      "position" = v_new_position
  where public.tasks.id = p_task_id;

  -- Cascade restore: only still-deleted children whose deleted_via_task_id
  -- points back to this task.
  for v_child in
    select t.id, t.status
    from public.tasks t
    where t.deleted_via_task_id = p_task_id
      and t.deleted_at is not null
  loop
    v_child_resolved_status := case
      when v_child.status = any(v_known_statuses) then v_child.status
      else 'todo'
    end;

    select t."position"
      into v_child_last_position
    from public.tasks t
    where t.project_id = v_project_id
      and t.status = v_child_resolved_status
      and t.deleted_at is null
    order by t."position" desc
    limit 1;

    v_child_position := coalesce(v_child_last_position, 0) + 1000;

    update public.tasks
    set deleted_at = null,
        deleted_by = null,
        deleted_via_task_id = null,
        status = v_child_resolved_status,
        "position" = v_child_position
    where public.tasks.id = v_child.id;
  end loop;

  return query
  select p_task_id, v_project_id, v_resolved_status, v_new_position, v_status_was_reset;
end;
$$;

revoke all on function public.restore_task_atomic(uuid) from public;
grant execute on function public.restore_task_atomic(uuid) to authenticated;
