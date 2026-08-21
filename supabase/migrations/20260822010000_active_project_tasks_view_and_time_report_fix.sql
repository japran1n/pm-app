-- F144 (AS-254): systematic sweep for archived-project task leaks into
-- workspace/task aggregates, plus a shared predicate so a FUTURE aggregate
-- cannot forget the filter.
--
-- Audit findings (grep across supabase/migrations/ + lib/queries/):
--   - get_priority_counts (F071), get_status_counts (F072),
--     get_overdue_count (F075/F124) — already correct: each already joins
--     `projects p` and filters `p.deleted_at is null` alongside
--     `t.deleted_at is null` (see each function's own AS-129 comment).
--     No fix needed; kept for reference/tests below.
--   - search_tasks (F068) + lib/queries/search.ts's searchWorkspaceTasks
--     (F069/F070) — already correct: the caller fetches the workspace's
--     `projects` with `.is("deleted_at", null)` BEFORE calling
--     `search_tasks` once per project, so an archived project's id never
--     even reaches the RPC. No fix needed.
--   - get_project_time_totals (F114) and get_project_board_tasks (F279) —
--     intentionally NOT touched: both are scoped by a single p_project_id
--     (a project viewing its OWN data on its OWN page), not a cross-project
--     workspace aggregate. Whether an archived project's own detail page
--     still shows its own historical time/board data is outside AS-254's
--     "excluded from the dashboard, search, and My Tasks" wording (those
--     are workspace-wide surfaces a task could leak INTO from a different,
--     archived project) — flagged explicitly in this feature's handoff
--     Out-of-scope section rather than silently changed.
--   - get_workspace_time_by_person (F115) — REAL GAP FOUND: joins
--     `time_entries -> tasks -> projects` (to reach `workspace_id`) but
--     only filtered `t.deleted_at is null`, never `p.deleted_at is null`.
--     An archived project's logged time was still being summed into the
--     workspace-wide per-person time report
--     (app/(workspace)/w/[workspaceSlug]/time/page.tsx). Fixed below.
--
-- Shared predicate (the "systematic" part of this feature): rather than
-- re-pasting `and p.deleted_at is null` at each of the N existing call
-- sites (ad-hoc copy-paste, exactly what this feature's spec says not to
-- do), every RPC that aggregates across `tasks` joined to `projects` now
-- selects from one view, `active_project_tasks`, which is the single place
-- "a task that counts toward a cross-project aggregate" is defined. A
-- future aggregate RPC only has to `from active_project_tasks` (or join to
-- it) instead of re-deriving the exclusion — it is structurally unable to
-- forget the filter because the view already applied it upstream.
--
-- `security_invoker = true` (Postgres 15+ view option, this project is on
-- a current-enough Postgres per tech-decisions.md's Supabase Postgres
-- baseline) so RLS on the underlying `tasks`/`projects` tables is
-- evaluated as the CALLING role, not the view owner — matching every
-- `security invoker` RPC in this codebase (see get_priority_counts's own
-- comment citing M6 scrutiny's finding that invoker is this project's safe
-- default).
create or replace view active_project_tasks
with (security_invoker = true)
as
select t.*, p.workspace_id as project_workspace_id
from tasks t
join projects p on p.id = t.project_id
where t.deleted_at is null
  and p.deleted_at is null;

revoke all on active_project_tasks from public;
grant select on active_project_tasks to authenticated, anon;

-- ---------------------------------------------------------------------
-- Rewire the three already-correct dashboard RPCs to select from the
-- shared view instead of re-deriving the same two-column exclusion
-- inline. Behaviour is unchanged (same predicate, same result set) — this
-- is a refactor to the single shared source of truth, not a behaviour fix,
-- for these three.
-- ---------------------------------------------------------------------
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

create or replace function get_overdue_count(p_workspace_id uuid, p_timezone text default 'UTC')
returns bigint
language sql
stable
security invoker
as $$
  select count(*)::bigint
  from active_project_tasks
  where project_workspace_id = p_workspace_id
    and due_date < (now() AT TIME ZONE p_timezone)::date
    and status <> 'done';
$$;

-- ---------------------------------------------------------------------
-- The real fix: get_workspace_time_by_person now joins through
-- active_project_tasks instead of raw `tasks` + a partial `projects` join,
-- so an archived project's logged time no longer counts toward the
-- workspace-wide per-person time report (AS-254-adjacent gap, this
-- feature's Files scope explicitly names lib/queries/time-entries.ts).
-- ---------------------------------------------------------------------
create or replace function get_workspace_time_by_person(
  p_workspace_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  user_id uuid,
  billable_minutes bigint,
  non_billable_minutes bigint
)
language sql
stable
security invoker
as $$
  select
    te.user_id,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes,
    coalesce(sum(te.minutes) filter (where not te.billable), 0)::bigint as non_billable_minutes
  from time_entries te
  join active_project_tasks t on t.id = te.task_id
  where t.project_workspace_id = p_workspace_id
    and te.entry_date between p_start_date and p_end_date
  group by te.user_id;
$$;

revoke all on function get_priority_counts(uuid) from public;
grant execute on function get_priority_counts(uuid) to authenticated, anon;
revoke all on function get_status_counts(uuid) from public;
grant execute on function get_status_counts(uuid) to authenticated, anon;
revoke all on function get_overdue_count(uuid, text) from public;
grant execute on function get_overdue_count(uuid, text) to authenticated, anon;
revoke all on function get_workspace_time_by_person(uuid, date, date) from public;
grant execute on function get_workspace_time_by_person(uuid, date, date) to authenticated, anon;
