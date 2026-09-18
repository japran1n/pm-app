-- Performance: replace the full table scan + JS-side grouping for the
-- watching feed (getWatchedTasksForUser) with a single DISTINCT ON query
-- that already returns one row per task_id.
--
-- security invoker: runs as the calling user so the RLS policy on
-- task_activity (is_task_visible_to) still filters results correctly.
-- stable: no writes; lets the planner cache and reuse the plan within
-- a transaction.

create or replace function get_latest_task_activity(task_ids uuid[])
returns table (
  task_id    uuid,
  actor_id   uuid,
  kind       text,
  field      text,
  old_value  jsonb,
  new_value  jsonb,
  created_at timestamptz
)
language sql
security invoker
stable
as $$
  select distinct on (ta.task_id)
    ta.task_id,
    ta.actor_id,
    ta.kind,
    ta.field,
    ta.old_value,
    ta.new_value,
    ta.created_at
  from task_activity ta
  where ta.task_id = any(task_ids)
  order by ta.task_id, ta.created_at desc;
$$;

grant execute on function get_latest_task_activity(uuid[]) to authenticated;
