-- UX-20 (UX audit, dashboard redesign): the workspace dashboard had one
-- KPI tile (Overdue) sitting in a `sm:grid-cols-3` grid with two empty
-- slots, and it wasn't even a link. Three more workspace-scoped counts so
-- the dashboard can show four small, clickable KPI tiles instead of one:
--
--   - get_due_soon_count  — unfinished tasks due within the next N days
--     (default 7), not yet overdue. Mirrors get_overdue_count's own shape
--     (same p_timezone param, same "not done" predicate) but the other
--     side of today.
--   - get_blocked_count   — unfinished tasks with at least one open
--     blocker, reusing the exact `task_dependencies` + is_done_status
--     predicate 20260824060000's get_project_board_tasks RPC already
--     established for a single project's open_blocker_count, just
--     counted at workspace scope instead of returned per-row.
--   - get_completed_count — tasks that entered a "done" category status
--     in the last N days (default 7). There's no separate
--     "completed_at" column on `tasks`, so this reads `updated_at` on
--     rows that are currently done — an acceptable approximation (a task
--     reopened and redone within the window would double count once,
--     not per transition) given nothing in this schema tracks status
--     transition history.
--
-- All three: `security invoker` over the existing `active_project_tasks`
-- view, identical RLS-scoping shape to get_overdue_count/
-- get_priority_counts/get_status_counts above.

create or replace function public.get_due_soon_count(
  p_workspace_id uuid,
  p_timezone text default 'UTC',
  p_days integer default 7
)
returns bigint
language sql
stable
security invoker
as $$
  select count(*)::bigint
  from active_project_tasks t
  where t.project_workspace_id = p_workspace_id
    and t.due_date is not null
    and t.due_date >= (now() AT TIME ZONE p_timezone)::date
    and t.due_date < (now() AT TIME ZONE p_timezone)::date + p_days
    and not public.is_done_status(t.status_id, t.status);
$$;

revoke all on function public.get_due_soon_count(uuid, text, integer) from public;
grant execute on function public.get_due_soon_count(uuid, text, integer) to authenticated, anon;

create or replace function public.get_blocked_count(p_workspace_id uuid)
returns bigint
language sql
stable
security invoker
as $$
  select count(distinct t.id)::bigint
  from active_project_tasks t
  join task_dependencies td on td.blocked_task_id = t.id
  join tasks blocking on blocking.id = td.blocking_task_id
  where t.project_workspace_id = p_workspace_id
    and not public.is_done_status(t.status_id, t.status)
    and blocking.deleted_at is null
    and not public.is_done_status(blocking.status_id, blocking.status);
$$;

revoke all on function public.get_blocked_count(uuid) from public;
grant execute on function public.get_blocked_count(uuid) to authenticated, anon;

create or replace function public.get_completed_count(
  p_workspace_id uuid,
  p_timezone text default 'UTC',
  p_days integer default 7
)
returns bigint
language sql
stable
security invoker
as $$
  select count(*)::bigint
  from active_project_tasks t
  where t.project_workspace_id = p_workspace_id
    and public.is_done_status(t.status_id, t.status)
    and t.updated_at >= (now() AT TIME ZONE p_timezone)::date - p_days;
$$;

revoke all on function public.get_completed_count(uuid, text, integer) from public;
grant execute on function public.get_completed_count(uuid, text, integer) to authenticated, anon;
