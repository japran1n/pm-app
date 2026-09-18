-- P2-19: single workspace-wide "by person AND day" RPC for the team heatmap.
--
-- Replaces the N-serial-call pattern in the time report page where one
-- `get_person_time_daily` call was fired per active workspace member. At 15
-- members that was 15 serial DB round-trips on every page load; this collapses
-- all of them into one.
--
-- Crucially, the WHERE clause on workspace_members also excludes `client` and
-- `guest` role members — those roles should never appear in the team heatmap,
-- which is a staff-only view of who is logging time inside the workspace.
--
-- Join chain: time_entries -> tasks -> projects -> workspace_members, the
-- same chain used by `get_workspace_time_by_person`
-- (supabase/migrations/20260818170000_rpc_workspace_time_by_person.sql) and
-- `get_workspace_time_by_person_and_project`
-- (supabase/migrations/20261109010000_rpc_person_time_reports.sql). Adding a
-- join on workspace_members (wm.workspace_id = p.workspace_id AND
-- wm.user_id = te.user_id) lets us filter to staff roles in one pass without
-- a second round-trip.
--
-- `language sql stable security invoker`: the RPC runs under the caller's own
-- role so RLS on time_entries (time_entries_select_active_members) and tasks
-- applies exactly as it would for any direct SELECT — a caller who isn't an
-- active member of the workspace sees zero rows, not an error and not another
-- workspace's data.
--
-- Parameter names use p_from / p_to (not p_start_date / p_end_date) to
-- mirror the TypeScript callers's `from` / `to` naming convention for date
-- ranges and to avoid shadowing the SQL `date` keyword in some PG contexts.
create or replace function get_workspace_time_by_person_and_day(
  p_workspace_id uuid,
  p_from date,
  p_to date
)
returns table (
  user_id uuid,
  entry_date date,
  total_minutes integer,
  billable_minutes integer
)
language sql
stable
security invoker
as $$
  select
    te.user_id,
    te.entry_date,
    coalesce(sum(te.minutes), 0)::integer as total_minutes,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::integer as billable_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  join projects p on p.id = t.project_id
  join workspace_members wm
    on wm.workspace_id = p.workspace_id
   and wm.user_id = te.user_id
  where p.workspace_id = p_workspace_id
    and wm.role in ('owner', 'admin', 'member')
    and wm.status = 'active'
    and t.deleted_at is null
    and te.entry_date between p_from and p_to
  group by te.user_id, te.entry_date;
$$;

revoke all on function get_workspace_time_by_person_and_day(uuid, date, date) from public;
grant execute on function get_workspace_time_by_person_and_day(uuid, date, date) to authenticated;
