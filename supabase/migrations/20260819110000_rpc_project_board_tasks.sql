-- F279: consolidate getProjectBoardTasks's per-render round trips
-- (AS-156).
--
-- Why this exists: F150 (subtask counts), F154 (checklist/completion
-- counts) and F157 (dependency/blocked state) each added their own
-- whole-project query to lib/queries/tasks.ts's getProjectBoardTasks —
-- individually reasonable (none is an N+1, all are whole-project not
-- per-card), but every added query is another network round trip to a
-- remote Supabase project, and tests/integration/perf-budget.test.ts's
-- AS-156 budget is a p95 WALL-CLOCK measurement, so the round trips sum
-- and the 500ms budget started failing (measured p95=520.6ms before this
-- migration).
--
-- This RPC folds all four of those queries (main task row + child/
-- subtask rows + checklist rows + open-blocker rows) into one Postgres
-- round trip, computing subtask_count, checklist counts and
-- open_blocker_count via lateral joins instead of assembling them in
-- TypeScript. `lib/queries/tasks.ts` keeps its own return shape
-- (`TaskCardTask`) — this RPC only changes how the row data is fetched,
-- not what the function returns to callers.
--
-- SECURITY INVOKER (not DEFINER), per this project's established RPC
-- convention (see get_priority_counts,
-- supabase/migrations/20260818054815_rpc_priority_counts.sql, itself
-- citing M6 scrutiny's finding that invoker is the safe default here).
-- Running under the caller's own role means RLS on `tasks`
-- (tasks_select_active_members), `checklist_items` and
-- `task_dependencies` applies exactly as it would for four separate
-- direct SELECTs — a caller who is not an active member of the task's
-- workspace sees zero rows, not another workspace's data. This is
-- strictly safer than the SECURITY DEFINER timer RPCs
-- (20260818153433_create_stop_and_start_timer_rpc.sql), which need
-- DEFINER only because they mutate through a single atomic transaction;
-- this RPC is read-only, so there is no reason to bypass RLS at all.
create or replace function public.get_project_board_tasks(p_project_id uuid)
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
  open_blocker_count bigint
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
    -- F150 (AS-275): count of this task's own children (any status).
    coalesce(child_agg.subtask_count, 0) as subtask_count,
    -- F154 (AS-272, AS-273): checklist total/done for THIS task's own
    -- checklist_items rows.
    coalesce(checklist_agg.checklist_total, 0) as checklist_total,
    coalesce(checklist_agg.checklist_done, 0) as checklist_done,
    -- F154 (AS-272, AS-273): child total/"done" pair, mirroring
    -- countSubtaskProgress's own status==='done' semantics, computed
    -- here instead of in TypeScript so completion% comes from the same
    -- single round trip.
    coalesce(child_agg.subtask_count, 0) as child_total,
    coalesce(child_agg.child_done, 0) as child_done,
    -- F157 (AS-283): count of OPEN blockers only (blocking task not done,
    -- not soft-deleted) — same semantics as the TypeScript
    -- openBlockerCounts map it replaces.
    coalesce(blocker_agg.open_blocker_count, 0) as open_blocker_count
  from tasks t
  join projects p on p.id = t.project_id
  left join lateral (
    select
      count(*)::bigint as subtask_count,
      count(*) filter (where c.status = 'done')::bigint as child_done
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
      and blocking.status <> 'done'
  ) blocker_agg on true
  where t.project_id = p_project_id
    and t.deleted_at is null
  order by t."position" asc;
$$;

revoke all on function public.get_project_board_tasks(uuid) from public;
grant execute on function public.get_project_board_tasks(uuid) to authenticated;
