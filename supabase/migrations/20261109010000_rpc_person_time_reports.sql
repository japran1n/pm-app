-- Foundational RPCs for the new per-person time-report UI (project
-- breakdown, daily breakdown, and workspace-by-person-and-project
-- drill-down). Follows the exact style/obrazac of
-- `get_workspace_time_by_person`
-- (supabase/migrations/20260818170000_rpc_workspace_time_by_person.sql):
-- `language sql stable security invoker`, running under the caller's own
-- role so RLS on `time_entries` (time_entries_select_active_members),
-- `tasks` (tasks_select_active_members) and `projects` applies exactly as
-- it would for any direct SELECT — a caller who isn't an active member of
-- the relevant workspace sees zero rows from the join, not an error and
-- not another workspace's data.
--
-- Scoping/join chain matches `get_workspace_time_by_person`:
-- time_entries -> tasks -> projects (-> workspace_id where relevant).
-- `t.deleted_at is null` excludes a soft-deleted task's logged time
-- entries, matching the existing convention. Date range is
-- `te.entry_date between p_start_date and p_end_date` (inclusive both
-- ends).
--
-- 1. get_person_time_by_project: one person's logged time, grouped by
--    project, over a date range. Used for a per-person time report page.
create or replace function get_person_time_by_project(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  project_id uuid,
  project_name text,
  total_minutes bigint,
  billable_minutes bigint
)
language sql
stable
security invoker
as $$
  select
    p.id as project_id,
    p.name as project_name,
    coalesce(sum(te.minutes), 0)::bigint as total_minutes,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  join projects p on p.id = t.project_id
  where te.user_id = p_user_id
    and t.deleted_at is null
    and te.entry_date between p_start_date and p_end_date
  group by p.id, p.name;
$$;

revoke all on function get_person_time_by_project(uuid, date, date) from public;
grant execute on function get_person_time_by_project(uuid, date, date) to authenticated, anon;

-- 2. get_person_time_daily: one person's logged time, grouped only by
--    entry_date (no project dimension) — for bar chart / calendar-grid
--    style displays of a single person's time.
create or replace function get_person_time_daily(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  entry_date date,
  total_minutes bigint,
  billable_minutes bigint
)
language sql
stable
security invoker
as $$
  select
    te.entry_date,
    coalesce(sum(te.minutes), 0)::bigint as total_minutes,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  where te.user_id = p_user_id
    and t.deleted_at is null
    and te.entry_date between p_start_date and p_end_date
  group by te.entry_date;
$$;

revoke all on function get_person_time_daily(uuid, date, date) from public;
grant execute on function get_person_time_daily(uuid, date, date) to authenticated, anon;

-- 3. get_workspace_time_by_person_and_project: extends
--    `get_workspace_time_by_person` with a project dimension, for
--    heatmap/drill-down views on the workspace time report page. Same
--    workspace scoping (time_entries -> tasks -> projects, filtered by
--    p.workspace_id) as the original RPC, plus a group-by on project.
create or replace function get_workspace_time_by_person_and_project(
  p_workspace_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  user_id uuid,
  project_id uuid,
  project_name text,
  billable_minutes bigint,
  non_billable_minutes bigint
)
language sql
stable
security invoker
as $$
  select
    te.user_id,
    p.id as project_id,
    p.name as project_name,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes,
    coalesce(sum(te.minutes) filter (where not te.billable), 0)::bigint as non_billable_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  join projects p on p.id = t.project_id
  where p.workspace_id = p_workspace_id
    and t.deleted_at is null
    and te.entry_date between p_start_date and p_end_date
  group by te.user_id, p.id, p.name;
$$;

revoke all on function get_workspace_time_by_person_and_project(uuid, date, date) from public;
grant execute on function get_workspace_time_by_person_and_project(uuid, date, date) to authenticated, anon;
