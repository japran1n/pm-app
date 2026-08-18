-- F075: dashboard overdue-count RPC (AS-131).
--
-- Mirrors F071/F072's `get_priority_counts`/`get_status_counts` RPCs
-- exactly (supabase/migrations/20260818054815_rpc_priority_counts.sql,
-- supabase/migrations/20260818070000_rpc_status_counts.sql):
-- `language sql stable security invoker` (invoker explicitly stated, not
-- merely the default, per M6 scrutiny's finding that SECURITY INVOKER is
-- the safe pattern for this project's RPCs). Running under the caller's
-- own role means RLS on `tasks` (tasks_select_active_members) and
-- `projects` (projects_select_active_members) applies exactly as it would
-- for any direct SELECT — a caller who is not an active member of
-- p_workspace_id sees a count of 0, not an error and not another
-- workspace's data. Same two-layer defense-in-depth as F070-F072: the
-- explicit `p.workspace_id = p_workspace_id` filter below and RLS's own
-- membership check both have to agree before any row is counted.
--
-- AS-131: "The dashboard shows a count of overdue tasks (due date in the
-- past, status not `done`)." This mirrors lib/tasks/is-overdue.ts's
-- (F040, AS-063/AS-064) logic in SQL:
--   - `t.due_date < current_date` — due_date is a plain DATE column, so
--     this is already a date-only comparison (no time-of-day / timezone
--     drift the way a timestamp comparison would have), matching
--     is-overdue.ts's explicit "date-only comparison" design.
--   - `t.status <> 'done'` — a completed task is never overdue regardless
--     of its due date (AS-064's rule, mirrored here).
--   - `t.due_date is not null` is implied: NULL < current_date is NULL
--     (not true) in SQL, so tasks with no due date are naturally excluded
--     without an explicit predicate, matching is-overdue.ts's
--     `if (!dueDate) return false;` guard.
--
-- Same exclusion rules as F071/F072 (dashboard-aggregate convention for
-- this project):
--   - `t.deleted_at is null` excludes soft-deleted tasks.
--   - `p.deleted_at is null` excludes tasks belonging to an archived
--     (soft-deleted) project by default.
--
-- Returns a single row/column (a scalar count), not a set of rows per
-- category like F071/F072 — there's only one overdue count per
-- workspace, so `returns bigint` is simpler than `returns table (...)`
-- for this shape. Computed via `count(*)` in the database, not a full
-- task-list fetch to the client, per the same AS-127-style constraint
-- F071/F072 were built under.
create or replace function get_overdue_count(p_workspace_id uuid)
returns bigint
language sql
stable
security invoker
as $$
  select count(*)::bigint
  from tasks t
  join projects p on p.id = t.project_id
  where p.workspace_id = p_workspace_id
    and t.deleted_at is null
    and p.deleted_at is null
    and t.due_date < current_date
    and t.status <> 'done';
$$;

revoke all on function get_overdue_count(uuid) from public;
grant execute on function get_overdue_count(uuid) to authenticated, anon;
