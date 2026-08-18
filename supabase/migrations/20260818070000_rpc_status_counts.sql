-- F072: dashboard status-count RPC (AS-126, AS-127, AS-128, AS-129).
--
-- AS-127 requires dashboard aggregates to be computed via a database
-- query (view/RPC), not by fetching the full task list to the client, so
-- this exposes a callable Postgres function
-- (supabase-js `.rpc('get_status_counts', ...)`) that returns one row
-- per status value present, with its task count, scoped to a workspace.
--
-- Mirrors F071's `get_priority_counts` RPC exactly
-- (supabase/migrations/20260818054815_rpc_priority_counts.sql), grouping
-- by status instead of priority:
-- `language sql stable security invoker` (invoker explicitly stated here,
-- not merely the default, per M6 scrutiny's finding that SECURITY INVOKER
-- is the safe pattern for this project). Running under the caller's own
-- role means RLS on `tasks` (tasks_select_active_members) and `projects`
-- (projects_select_active_members) applies exactly as it would for any
-- direct SELECT — a caller who is not an active member of p_workspace_id
-- sees zero rows from the join, not an error and not another workspace's
-- data. This is a defense-in-depth match to F070's two-layer pattern: the
-- explicit `p.workspace_id = p_workspace_id` filter below and RLS's own
-- membership check both have to agree before any row is counted.
--
-- AS-126: powers the dashboard's status pie chart, scoped to the active
-- workspace.
-- AS-128: `t.deleted_at is null` excludes soft-deleted tasks.
-- AS-129: `p.deleted_at is null` excludes tasks belonging to archived
-- (soft-deleted) projects by default, per discovery's stated default of
-- excluding archived-project tasks unless explicitly toggled to include
-- them — this RPC only implements the default (exclude) path; a future
-- feature can add a `p_include_archived boolean default false` parameter
-- if the toggle itself is built.
create or replace function get_status_counts(p_workspace_id uuid)
returns table (status text, count bigint)
language sql
stable
security invoker
as $$
  select t.status, count(*)::bigint as count
  from tasks t
  join projects p on p.id = t.project_id
  where p.workspace_id = p_workspace_id
    and t.deleted_at is null
    and p.deleted_at is null
  group by t.status;
$$;

revoke all on function get_status_counts(uuid) from public;
grant execute on function get_status_counts(uuid) to authenticated, anon;
