-- F222 (AS-410): "a task counts as complete for progress, overdue, and
-- dependency purposes when its column category is done" — SQL half of
-- this feature's sweep. Every RPC/trigger that decided completeness via
-- the literal string comparison `status = 'done'` now decides via
-- `project_statuses.category = 'done'` instead, so a renamed/custom
-- done-category column (F219/F221) is honored and a column merely NAMED
-- something like "done-ish" whose category ISN'T `done` no longer counts.
--
-- Single shared SQL helper (mirrors lib/tasks/status-category.ts's
-- `isDoneStatus` on the TypeScript side — one rule, two runtimes, not two
-- independent copies): `public.is_done_status(status_id, status)`.
-- `language sql stable` (not plpgsql) so a simple single-statement body
-- like this one is eligible for the planner to inline at each call site
-- (no per-row function-call overhead in the lateral joins/filters below).
-- No `security definer` — this must run under the CALLING role's own
-- privileges wherever it's used, same "security invoker propagates
-- through nested calls" posture as every other RPC in this file (the one
-- exception, notify_overdue_task_assignees, is itself SECURITY DEFINER;
-- see that function's own note below for why that's still correct here).
--
-- `status_id is null` edge case (explicitly decided, not left to chance):
-- falls back to the literal `status = 'done'` comparison — the exact
-- pre-F222 behaviour — rather than guessing "done" or "not done" for a
-- task whose status_id never resolved (F218's sync trigger keeps the two
-- columns in lockstep on every write, so this is only reachable for
-- pre-F218 data that predates the backfill, if any ever slipped through).
create or replace function public.is_done_status(p_status_id uuid, p_status text)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select ps.category = 'done' from project_statuses ps where ps.id = p_status_id),
    p_status = 'done'
  );
$$;

revoke all on function public.is_done_status(uuid, text) from public;
grant execute on function public.is_done_status(uuid, text) to authenticated, anon, postgres, service_role;

-- ---------------------------------------------------------------------
-- get_project_board_tasks: child_done (F154/AS-272,273) and
-- open_blocker_count (F157/AS-283) both previously compared a related
-- task's `status` to the literal 'done'. Row type is unchanged from
-- 20260822170000_rpc_project_board_tasks_recurrence.sql (still ending in
-- `recurrence jsonb`) plus this migration's new `status_category`
-- column, added so the board's own overdue badge (TaskCard, via
-- lib/queries/tasks.ts) is also category-aware — same "why fix the SQL
-- twin, not just the TypeScript one" rationale this feature's brief
-- calls out explicitly. Postgres requires a `drop function` first since
-- the OUT-parameter row type is changing (adding a column), same as
-- every prior migration against this function.
-- ---------------------------------------------------------------------
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
  status_category text
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
    -- F222 (AS-410): this task's own column category, straight off
    -- project_statuses via status_id — feeds TaskCard's isOverdue call.
    ts.category as status_category
  from tasks t
  join projects p on p.id = t.project_id
  left join project_statuses ts on ts.id = t.status_id
  left join lateral (
    select
      count(*)::bigint as subtask_count,
      -- F222 (AS-410): category-aware, was `c.status = 'done'`.
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
      -- F222 (AS-410): category-aware, was `blocking.status <> 'done'`.
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

-- ---------------------------------------------------------------------
-- active_project_tasks (F144) was created by
-- 20260822010000_active_project_tasks_view_and_time_report_fix.sql as
-- `select t.*, p.workspace_id ...` — `t.*` is expanded to the column
-- LIST that existed on `tasks` at CREATE VIEW time, not re-evaluated on
-- every read, so this view never picked up any of `tasks`' several
-- columns added since (F218's `status_id` among them) in the same
-- relative position `create or replace view` requires (append-only,
-- same order) — confirmed by this migration's own first attempt, which
-- Postgres rejected with "cannot change name of view column
-- ...  to ...". A view has no `ALTER VIEW ... ADD COLUMN`; the only way
-- to pick up `tasks`' current column list is `drop view ... cascade` +
-- recreate. `cascade` also drops the three RPCs that select from this
-- view (get_priority_counts, get_status_counts, get_overdue_count) —
-- all three are recreated immediately below, get_priority_counts/
-- get_status_counts byte-for-byte identical to
-- 20260822010000's own definitions (behaviour unchanged, this feature
-- doesn't touch either — AS-412's "dashboard status chart reflects
-- custom columns" is F223/out of this feature's scope), get_overdue_count
-- with this feature's category-aware predicate.
drop view if exists active_project_tasks cascade;

create view active_project_tasks
with (security_invoker = true)
as
select t.*, p.workspace_id as project_workspace_id
from tasks t
join projects p on p.id = t.project_id
where t.deleted_at is null
  and p.deleted_at is null;

revoke all on active_project_tasks from public;
grant select on active_project_tasks to authenticated, anon;

create or replace function get_priority_counts(p_workspace_id uuid)
returns table (priority text, count bigint)
language sql
stable
security invoker
as $$
  select priority, count(*)::bigint as count
  from active_project_tasks
  where project_workspace_id = p_workspace_id
  group by priority;
$$;

create or replace function get_status_counts(p_workspace_id uuid)
returns table (status text, count bigint)
language sql
stable
security invoker
as $$
  select status, count(*)::bigint as count
  from active_project_tasks
  where project_workspace_id = p_workspace_id
  group by status;
$$;

grant execute on function get_priority_counts(uuid) to authenticated, anon;
grant execute on function get_status_counts(uuid) to authenticated, anon;

-- get_overdue_count (F075/F124, most recently
-- 20260822010000_active_project_tasks_view_and_time_report_fix.sql,
-- reading from the `active_project_tasks` view rather than raw
-- `tasks`/`projects`). Signature unchanged — `create or replace` is
-- sufficient.
-- ---------------------------------------------------------------------
create or replace function public.get_overdue_count(p_workspace_id uuid, p_timezone text default 'UTC')
returns bigint
language sql
stable
security invoker
as $$
  select count(*)::bigint
  from active_project_tasks t
  where t.project_workspace_id = p_workspace_id
    and t.due_date < (now() AT TIME ZONE p_timezone)::date
    -- F222 (AS-410): category-aware, was `t.status <> 'done'`.
    and not public.is_done_status(t.status_id, t.status);
$$;

revoke all on function public.get_overdue_count(uuid, text) from public;
grant execute on function public.get_overdue_count(uuid, text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- notify_overdue_task_assignees (F212/F321, most recently
-- 20260823120000_fix_overdue_sweep_orphaned_assignee.sql). Signature
-- unchanged (still `returns integer`, no arguments) — `create or replace`
-- is sufficient. SECURITY DEFINER (pg_cron has no human session): the
-- nested `is_done_status` call runs under this function's execution role
-- for the duration of this call (definer semantics apply to the whole
-- call graph, not just the outermost statement), so it needs execute
-- granted to postgres/service_role too — see this migration's grant on
-- is_done_status above.
-- ---------------------------------------------------------------------
create or replace function public.notify_overdue_task_assignees()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_notified_count integer := 0;
begin
  for v_row in
    select t.id as task_id, t.title as task_title, t.due_date as due_date,
           p.id as project_id, p.workspace_id as workspace_id,
           ta.user_id as assignee_id
    from tasks t
    join projects p on p.id = t.project_id
    join task_assignees ta on ta.task_id = t.id
    join notification_preferences np on np.user_id = ta.user_id
    join workspace_members wm
      on wm.workspace_id = p.workspace_id
     and wm.user_id = ta.user_id
     and wm.status = 'active'
    where t.due_date is not null
      and t.due_date <= (now() at time zone 'utc')::date
      -- F222 (AS-410): category-aware, was `t.status <> 'done'`.
      and not public.is_done_status(t.status_id, t.status)
      and t.deleted_at is null
      and p.deleted_at is null
      and np.task_due_soon_in_app = true
      and not exists (
        select 1
        from notifications n
        where n.user_id = ta.user_id
          and n.task_id = t.id
          and n.kind = 'task_due_soon'
      )
  loop
    begin
      perform public.create_notification(
        p_user_id => v_row.assignee_id,
        p_workspace_id => v_row.workspace_id,
        p_kind => 'task_due_soon',
        p_actor_id => null,
        p_task_id => v_row.task_id,
        p_comment_id => null,
        p_payload => jsonb_build_object('task_title', v_row.task_title, 'due_date', v_row.due_date),
        p_system => true
      );

      v_notified_count := v_notified_count + 1;
    exception
      when others then
        raise warning
          'notify_overdue_task_assignees: failed to notify user % for task % (workspace %): % (%)',
          v_row.assignee_id, v_row.task_id, v_row.workspace_id, sqlerrm, sqlstate;
    end;
  end loop;

  return v_notified_count;
end;
$$;

comment on function public.notify_overdue_task_assignees() is
  'F212/F321/F222 (AS-383, AS-410): hourly sweep notifying each assignee of a task once its due date has passed (UTC-only for now -- see 20260823050000''s header comment). Skips archived projects, trashed tasks, done-CATEGORY tasks (project_statuses.category = ''done'', via is_done_status -- F222), assignees who opted out via notification_preferences.task_due_soon_in_app, and (F321) assignees who are no longer an active member of the task''s workspace. Per-row exception handling means one bad/unanticipated row can never abort the whole sweep. Idempotent -- see notifications_overdue_once_idx. SECURITY DEFINER so pg_cron (running as postgres, no human session) can call create_notification(..., p_system => true).';

revoke all on function public.notify_overdue_task_assignees() from public;
grant execute on function public.notify_overdue_task_assignees() to postgres, service_role;
