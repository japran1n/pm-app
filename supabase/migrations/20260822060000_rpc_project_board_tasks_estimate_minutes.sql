-- F167 follow-up fix: getProjectBoardTasks (lib/queries/tasks.ts) feeds
-- TaskCard.estimateMinutes (F167, AS-300..AS-302) through the
-- get_project_board_tasks RPC (20260819110000_rpc_project_board_tasks.sql).
-- That RPC never selected tasks.estimate_minutes (F166's
-- 20260822030000_tasks_estimate_minutes.sql column postdates it), so the
-- board/list `TaskCard` never actually received a real estimate — F167's
-- own render logic was correct but unreachable. This migration
-- `create or replace`s the same function, adding one output column
-- (`estimate_minutes`) and one `t.estimate_minutes` select-list entry; the
-- FROM/JOIN/WHERE/ORDER BY are otherwise byte-for-byte unchanged from the
-- prior migration, so subtask/checklist/blocker aggregation and the
-- security invoker / RLS posture (tasks_select_active_members) are
-- unaffected.
-- Postgres refuses `create or replace` when the OUT-parameter row type
-- changes (adding a column), so the prior version must be dropped first.
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
  estimate_minutes integer
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
    coalesce(blocker_agg.open_blocker_count, 0) as open_blocker_count,
    -- F167 follow-up (AS-300..AS-302): plain nullable column, no
    -- aggregation needed — feeds TaskCard's estimate-vs-logged UI.
    t.estimate_minutes
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
