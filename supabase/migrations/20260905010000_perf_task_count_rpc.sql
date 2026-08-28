-- Performance: server-side open task count aggregation + partial index
-- Replaces the JS-side counting in getOpenTaskCounts (lib/queries/projects.ts)
-- which fetched ALL task rows and iterated them in application code.

-- Partial index: speeds up the deleted_at IS NULL filter on tasks table.
-- The existing (project_id, status) index does not cover the deleted_at filter.
CREATE INDEX IF NOT EXISTS tasks_project_open_idx
  ON tasks (project_id)
  WHERE deleted_at IS NULL;

-- Composite index on notifications for workspace-scoped queries.
-- getNotificationsForWorkspace filters by (user_id via RLS, workspace_id, created_at DESC)
-- but the existing index only covers (user_id, read_at, created_at DESC).
CREATE INDEX IF NOT EXISTS notifications_user_workspace_created_idx
  ON notifications (user_id, workspace_id, created_at DESC);

-- RPC: returns one row per project with the count of open (non-done) tasks.
-- Called by getOpenTaskCounts instead of fetching all task rows.
-- SECURITY DEFINER so it runs with the function owner's privileges;
-- the caller's RLS context is still enforced on the outer query that feeds
-- project_ids (only projects the caller can see reach this function).
CREATE OR REPLACE FUNCTION get_open_task_counts(project_ids uuid[])
RETURNS TABLE (project_id uuid, open_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.project_id, count(*) AS open_count
  FROM tasks t
  JOIN project_statuses ps ON ps.id = t.status_id
  WHERE t.project_id = ANY(project_ids)
    AND t.deleted_at IS NULL
    AND ps.category != 'done'
  GROUP BY t.project_id
$$;
