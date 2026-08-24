-- F224 (AS-418, AS-423): the board's swimlane grouping control offers
-- "tag" as one of its group-by fields (alongside assignee and priority),
-- and grouping is computed client-side from the already-loaded task set
-- (per this feature's Clarified implementation's performance budget --
-- no per-row/N+1 query). `get_project_board_tasks` (the board's single
-- data round trip, see 20260819110000_rpc_project_board_tasks.sql's own
-- comment for why everything the board needs is folded into one RPC) has
-- never returned `tasks.tags` -- the same "built but unreachable" trap
-- F161/F167/F179 each independently hit and fixed for assignee_ids/
-- estimate_minutes/recurrence on this exact function. This migration
-- adds one more passthrough column, `tags text[]`, straight off the base
-- table (no join, no aggregation needed -- `tags` already lives directly
-- on `tasks`, per lib/actions/tasks.ts's updateTaskTags). Every
-- previously-added column, and the FROM/JOIN/WHERE/ORDER BY, are
-- otherwise byte-for-byte unchanged from 20260824060000's version.
--
-- Postgres refuses `create or replace` when the OUT-parameter row type
-- changes (adding a column) -- drop first, same as every prior migration
-- against this function.
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
  tags text[]
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
    -- F224 (AS-418, AS-423): straight off the base table, no join --
    -- coalesced to `array[]::text[]` so the board's client-side grouping
    -- (lib/board/grouping.ts) can treat "never set" and "explicitly
    -- cleared to []" identically as "no tags" (AS-423's None lane),
    -- never a null it would have to special-case.
    coalesce(t.tags, array[]::text[]) as tags
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
