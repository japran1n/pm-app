-- F115: per-person time report RPC (AS-173, AS-174).
--
-- AS-173 requires a per-person time report scoped to a workspace, showing
-- total logged time per member over a selectable date range. Follows
-- F114's `get_project_time_totals` pattern
-- (supabase/migrations/20260818160000_rpc_project_time_totals.sql):
-- `language sql stable security invoker`, running under the caller's own
-- role so RLS on `time_entries` (time_entries_select_active_members,
-- supabase/migrations/20260818151501_create_time_entries.sql) and `tasks`
-- (tasks_select_active_members) applies exactly as it would for any direct
-- SELECT — a caller who isn't an active member of p_workspace_id sees zero
-- rows from the join, not an error and not another workspace's data
-- (AS-176: this is the same mechanism F077 verified for the dashboard
-- RPCs).
--
-- Scoping: time_entries -> tasks -> projects -> workspace_id, same join
-- depth used by F114 (time_entries -> tasks -> projects) plus one more hop
-- to workspace_id since this RPC is workspace-scoped rather than
-- project-scoped.
--
-- AS-174: `t.deleted_at is null` excludes a soft-deleted task's logged
-- time entries from the total, matching F114's convention for the same
-- column.
--
-- Date range: `te.entry_date between p_start_date and p_end_date`
-- (inclusive both ends), matching the "selectable date range" wording of
-- AS-173 and the UI's date-range picker passing inclusive start/end dates.
create or replace function get_workspace_time_by_person(
  p_workspace_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  user_id uuid,
  billable_minutes bigint,
  non_billable_minutes bigint
)
language sql
stable
security invoker
as $$
  select
    te.user_id,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes,
    coalesce(sum(te.minutes) filter (where not te.billable), 0)::bigint as non_billable_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  join projects p on p.id = t.project_id
  where p.workspace_id = p_workspace_id
    and t.deleted_at is null
    and te.entry_date between p_start_date and p_end_date
  group by te.user_id;
$$;

revoke all on function get_workspace_time_by_person(uuid, date, date) from public;
grant execute on function get_workspace_time_by_person(uuid, date, date) to authenticated, anon;
