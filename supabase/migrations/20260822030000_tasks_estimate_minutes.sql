-- F166: task estimate field (AS-298, AS-299, AS-305)
--
-- estimate_minutes is a plain nullable integer on tasks, mirroring
-- time_entries.minutes' storage convention (plain integer minute count,
-- not an interval/duration type) from
-- supabase/migrations/20260818151501_create_time_entries.sql.
--
-- CHECK (estimate_minutes > 0) enforces AS-299 (zero/negative estimates
-- rejected) at the database level, matching
-- time_entries_minutes_positive's exact shape. NULL remains a valid
-- "no estimate set" state (empty/zero state, per this feature's
-- Clarified implementation).
--
-- No RLS changes: tasks already has RLS policies (workspace-membership
-- scoped) from earlier migrations; estimate_minutes is just another
-- column on that same row, read/written through the existing policies.
-- Access control for *who* may change it is enforced at the Server
-- Action layer via canEditTask (F127), per this feature's Clarified
-- implementation (access control note) — no new SQL predicate needed
-- since this isn't a new resource type, just a new column.
--
-- No index: estimate_minutes is not used in a WHERE/ORDER BY of any
-- query this feature enables (it's read/written on a single task row by
-- id, same as priority/due_date), so no new index is required per this
-- mission's "index every FK and every column named in a WHERE/ORDER BY"
-- convention.

alter table tasks
  add column if not exists estimate_minutes integer;

alter table tasks
  add constraint tasks_estimate_minutes_positive
  check (estimate_minutes is null or estimate_minutes > 0);
