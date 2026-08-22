-- F161 follow-through: getProjectBoardTasks (lib/queries/tasks.ts) feeds
-- TaskCard's new UserAvatarGroup (AS-287, AS-288) through the
-- get_project_board_tasks RPC
-- (supabase/migrations/20260822060000_rpc_project_board_tasks_estimate_minutes.sql).
-- That RPC never selected `task_assignees` (F159's join table postdates
-- its original 20260819110000 version), so the board/list `TaskCard`
-- would only ever have seen the single deprecated `assignee_id` mirror,
-- never the real multi-assignee set — the same "built but unreachable"
-- trap F167's own follow-up fixed for `estimate_minutes`. This migration
-- `create or replace`s the same function again, adding one more output
-- column (`assignee_ids`, a uuid array aggregated from `task_assignees`,
-- ordered oldest-first to match `setTaskAssigneesCore`'s own mirror
-- tie-break rule in lib/actions/tasks.ts). FROM/JOIN/WHERE/ORDER BY and
-- every previously-added column are otherwise byte-for-byte unchanged.
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
  estimate_minutes integer,
  assignee_ids uuid[]
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
    -- F161 (AS-287, AS-288): every current assignee for this task, oldest
    -- first — same ordering `setTaskAssigneesCore`'s mirror rule uses
    -- (lib/actions/tasks.ts), so a caller that only wants "the first
    -- assignee" can just take element 0 instead of relying on
    -- `assignee_id` separately. `coalesce(..., array[]::uuid[])` so a
    -- task with zero assignees returns an empty array, never null, per
    -- this codebase's "safe default, no extra null check at every call
    -- site" convention (see estimate_minutes/subtask_count above for the
    -- same pattern with 0 instead of an empty array).
    coalesce(assignee_agg.assignee_ids, array[]::uuid[]) as assignee_ids
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
