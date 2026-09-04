-- F090 item 2: F083 (AS client-visibility/awaiting-client indicators)
-- added `client_visible`/`pending_client_approval` chips to the List view
-- and My Tasks (components/task/task-card.tsx already renders both --
-- see the `task.clientVisible`/`task.pendingClientApproval` blocks there,
-- gated behind `data-testid="client-visible-indicator"`/
-- `"awaiting-client-indicator"`), but could not reach the Board because
-- the board's data comes from the single `get_project_board_tasks` RPC
-- (supabase/migrations/20260819110000_rpc_project_board_tasks.sql),
-- which never selected those two columns, and migrations were off-limits
-- to that worker at the time.
--
-- Both columns already exist on `tasks` --
-- 20260902010000_client_role_and_task_client_visibility.sql added
-- `client_visible boolean not null default false`, and
-- 20260903050000_task_pending_client_approval.sql added
-- `pending_client_approval boolean not null default false`. This
-- migration is a straight passthrough off the base table, same shape as
-- every prior "add one more RPC column" migration against this function
-- (20260822040000/-060000/-070000/-170000, 20260825020000) -- no join,
-- no aggregation.
--
-- Postgres refuses `create or replace` when the OUT-parameter row type
-- changes (adding a column) -- drop first, same as every prior migration
-- against this function.
--
-- `security invoker`, no `set search_path` line -- matching this
-- function's own prior migrations and the documented convention (see
-- 20261027010000_f087_search_tasks_multi_project.sql's comment): that
-- pinning is reserved for `security definer` functions elsewhere in this
-- schema, which run with elevated privilege.
--
-- Every current caller of `get_project_board_tasks` was checked before
-- this change: lib/queries/tasks.ts's `getProjectBoardTasks` (the only
-- application caller, destructures the RPC row by column name -- adding
-- columns is additive and safe), plus the test suite's own direct
-- `.rpc("get_project_board_tasks", ...)` calls in
-- tests/integration/f224-board-swimlane-grouping.test.ts and the other
-- integration tests that reference this RPC only in comments (board-
-- reload-persistence, f222-status-category-semantics, trash-exclusion-
-- board) -- none of them assert an exhaustive/closed column list, so
-- appending two columns does not break them.
drop function if exists public.get_project_board_tasks(uuid);

create function public.get_project_board_tasks(p_project_id uuid)
returns table (
  id uuid,
  title text,
  status text,
  priority text,
  assignee_id uuid,
  due_date date,
  "position" double precision,
  updated_at timestamptz,
  number integer,
  project_key text,
  subtask_count bigint,
  checklist_total bigint,
  checklist_done bigint,
  child_total bigint,
  child_done bigint,
  open_blocker_count bigint,
  estimate_minutes integer,
  assignee_ids uuid[],
  recurrence jsonb,
  status_category text,
  tags text[],
  client_visible boolean,
  pending_client_approval boolean
)
language sql
stable
security invoker
as $$
  select
    t.id,
    t.title,
    t.status,
    t.priority,
    t.assignee_id,
    t.due_date,
    t."position",
    t.updated_at,
    t.number,
    p.key as project_key,
    coalesce(child_agg.subtask_count, 0) as subtask_count,
    coalesce(checklist_agg.checklist_total, 0) as checklist_total,
    coalesce(checklist_agg.checklist_done, 0) as checklist_done,
    coalesce(child_agg.subtask_count, 0) as child_total,
    coalesce(child_agg.child_done, 0) as child_done,
    coalesce(blocker_agg.open_blocker_count, 0) as open_blocker_count,
    t.estimate_minutes,
    coalesce(assignee_agg.assignee_ids, array[]::uuid[]) as assignee_ids,
    t.recurrence,
    ts.category as status_category,
    coalesce(t.tags, array[]::text[]) as tags,
    -- F090 item 2: straight off the base table, same "coalesce at the
    -- SQL boundary, never a bare null" convention as `tags` immediately
    -- above -- both columns are `not null default false` already, so the
    -- coalesce is defence-in-depth rather than a real null case today.
    coalesce(t.client_visible, false) as client_visible,
    coalesce(t.pending_client_approval, false) as pending_client_approval
  from tasks t
  join projects p on p.id = t.project_id
  left join project_statuses ts on ts.id = t.status_id
  left join lateral (
    select
      count(*)::bigint as subtask_count,
      count(*) filter (where public.is_done_status(c.status_id, c.status))::bigint as child_done
    from tasks c
    where c.parent_task_id = t.id
      and c.deleted_at is null
  ) child_agg on true
  left join lateral (
    select
      count(*)::bigint as checklist_total,
      count(*) filter (where ci.is_checked)::bigint as checklist_done
    from checklist_items ci
    where ci.task_id = t.id
  ) checklist_agg on true
  left join lateral (
    select count(*)::bigint as open_blocker_count
    from task_dependencies td
    join tasks blocking on blocking.id = td.blocking_task_id
    where td.blocked_task_id = t.id
      and blocking.deleted_at is null
      and not public.is_done_status(blocking.status_id, blocking.status)
  ) blocker_agg on true
  left join lateral (
    select array_agg(ta.user_id order by ta.created_at asc, ta.user_id asc)
      as assignee_ids
    from task_assignees ta
    where ta.task_id = t.id
  ) assignee_agg on true
  where t.project_id = p_project_id
    and t.deleted_at is null
  order by t."position" asc;
$$;

revoke all on function public.get_project_board_tasks(uuid) from public;
grant execute on function public.get_project_board_tasks(uuid) to authenticated;
