-- F114: project time totals RPC (AS-172, AS-174).
--
-- AS-172 requires a project's total logged time, split into billable and
-- non-billable minutes, to be displayed on the project header. Follows
-- F071/F072's pattern (supabase/migrations/20260818054815_rpc_priority_counts.sql,
-- supabase/migrations/20260818070000_rpc_status_counts.sql):
-- `language sql stable security invoker`, running under the caller's own
-- role so RLS on `time_entries` (time_entries_select_active_members,
-- supabase/migrations/20260818151501_create_time_entries.sql) and `tasks`
-- (tasks_select_active_members) applies exactly as it would for any direct
-- SELECT — a caller who isn't an active member of the project's workspace
-- sees zero rows from the join, not an error and not another workspace's
-- data.
--
-- AS-174: `t.deleted_at is null` excludes a soft-deleted task's logged
-- time entries from the total, matching F071's `t.deleted_at is null`
-- convention for the same column.
create or replace function get_project_time_totals(p_project_id uuid)
returns table (billable_minutes bigint, non_billable_minutes bigint)
language sql
stable
security invoker
as $$
  select
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes,
    coalesce(sum(te.minutes) filter (where not te.billable), 0)::bigint as non_billable_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  where t.project_id = p_project_id
    and t.deleted_at is null;
$$;

revoke all on function get_project_time_totals(uuid) from public;
grant execute on function get_project_time_totals(uuid) to authenticated, anon;
