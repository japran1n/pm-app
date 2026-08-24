-- F236: tasks.start_date (AS-453: a task can have a start date, which
-- must not be after its due date).
--
-- Additive, non-destructive, nullable, no backfill guessing (Clarified
-- implementation: "no backfill guessing — do not invent start dates for
-- existing tasks"). Sibling column to `tasks.due_date`
-- (supabase/migrations/20260818013434_create_tasks.sql): same `date`
-- type (not timestamptz) — matches this milestone's calendar convention
-- (lib/calendar/month-grid.ts's doc comment) that a task date is a plain
-- "YYYY-MM-DD" calendar date with no time-of-day/timezone component and
-- is never round-tripped through a local-timezone `Date`.
--
-- Ordering rule (this feature's own Draft scope + resolved via the
-- clarification's ambiguity-resolution default: simplest option, no new
-- dependency, no second source of truth): a start date must not be AFTER
-- its due date. Both null is fine (no dates set). Either one null with
-- the other set is fine (AS-453's "single-day bar" case for the
-- timeline, F237) — the CHECK only compares the two when BOTH are
-- present, exactly like the "one null, one set" cases documented in
-- F236-db-task-start-date.md's Draft scope note ("including a null due
-- date with a set start date").
alter table tasks add column if not exists start_date date null;

alter table tasks
  drop constraint if exists tasks_start_date_not_after_due_date;
alter table tasks
  add constraint tasks_start_date_not_after_due_date
  check (
    start_date is null
    or due_date is null
    or start_date <= due_date
  );

-- Performance budget (Clarified implementation #8): index the column
-- this feature's own future readers (F237's timeline range query: "all
-- tasks whose [start_date, due_date] interval intersects the visible
-- window") will filter/order on — same "index every FK and every column
-- named in a WHERE/ORDER BY of the queries this feature enables"
-- convention as project_statuses_project_id_position_idx above.
create index if not exists tasks_start_date_idx on tasks (start_date);

-- No RLS change needed: `tasks` already has row-level security enabled
-- and scoped via the existing project-visibility policies (see
-- supabase/migrations/20260821140526_project_visibility_rls_sweep.sql) —
-- this is a plain nullable column addition to an already-RLS-covered
-- table, not a new table, so no new policy is required (Clarified
-- implementation #9: "existing policies are extended, not replaced,
-- unless the spec says otherwise" — this column needs no extension since
-- the existing per-row predicate already covers it).

-- Cascade-path safety check (per this feature's own instruction, mirrors
-- the F219 blocker where a guard made project hard-delete impossible):
-- this CHECK constraint only references columns on the SAME row
-- (start_date, due_date) — it has no FK, no cross-row reference, and no
-- trigger. `tasks.project_id` itself has NO `ON DELETE CASCADE`
-- (supabase/migrations/20260818013434_create_tasks.sql:
-- `project_id uuid not null references projects (id)`, plain, no
-- cascade) — the real delete flow (and every existing integration
-- test's own teardown) deletes a project's tasks first, then the
-- project. Either way, a DELETE only ever evaluates a CHECK constraint
-- on the row being deleted itself, never a cross-row aggregate, so this
-- CHECK cannot block a task delete or a project delete under any
-- ordering. Verified in tests/integration/tasks-start-date.test.ts
-- ("project hard-delete still works with start_date set on its tasks").
