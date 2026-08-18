-- F071: dashboard priority-count RPC (AS-125, AS-127, AS-128, AS-129).
--
-- AS-127 requires dashboard aggregates to be computed via a database
-- query (view/RPC), not by fetching the full task list to the client, so
-- this exposes a callable Postgres function
-- (supabase-js `.rpc('get_priority_counts', ...)`) that returns one row
-- per priority value present, with its task count, scoped to a workspace.
--
-- Follows F068's `search_tasks` pattern
-- (supabase/migrations/20260818050300_fts_tasks_search_fn.sql):
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
-- AS-128: `t.deleted_at is null` excludes soft-deleted tasks.
-- AS-129: `p.deleted_at is null` excludes tasks belonging to archived
-- (soft-deleted) projects by default, per discovery's stated default of
-- excluding archived-project tasks unless explicitly toggled to include
-- them — this RPC only implements the default (exclude) path; a future
-- feature can add a `p_include_archived boolean default false` parameter
-- if the toggle itself is built.
create or replace function get_priority_counts(p_workspace_id uuid)
returns table (priority text, count bigint)
language sql
stable
security invoker
as $$
  select t.priority, count(*)::bigint as count
  from tasks t
  join projects p on p.id = t.project_id
  where p.workspace_id = p_workspace_id
    and t.deleted_at is null
    and p.deleted_at is null
  group by t.priority;
$$;

revoke all on function get_priority_counts(uuid) from public;
grant execute on function get_priority_counts(uuid) to authenticated, anon;
