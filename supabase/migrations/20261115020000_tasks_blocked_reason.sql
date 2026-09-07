-- Free-text "why is this blocked" reason on a task, shown on the task
-- detail sheet whenever the task currently sits in a board column named
-- "Blocked" (case-insensitive), and surfaced as a small icon+tooltip on
-- the board card and list row.
--
-- Same additive, nullable, no-DB-CHECK-on-status shape as
-- `project_phases.blocked_reason`
-- (20261031010000_f109_phase_blocked_reason.sql) -- see that migration's
-- header for the full "why free text, why app-layer not a DB CHECK"
-- rationale, which applies identically here. One difference from that
-- migration: `tasks.status` is free text tied to a project's OWN
-- `project_statuses` rows (20260824010000_project_statuses.sql), not a
-- fixed enum -- there is no single literal value every task's "blocked"
-- state is guaranteed to carry, so this column is never required by a DB
-- CHECK keyed on `status = 'blocked'` the way a fixed-enum column might
-- invite; the app layer (task-detail-sheet.tsx) decides "is this task
-- blocked" by comparing `status` case-insensitively to "blocked", the
-- same free-text column a project's board columns are already named
-- from.
alter table tasks
  add column if not exists blocked_reason text;

alter table tasks
  add constraint tasks_blocked_reason_length_check
    check (blocked_reason is null or char_length(blocked_reason) <= 500) not valid;

alter table tasks
  validate constraint tasks_blocked_reason_length_check;

comment on column tasks.blocked_reason is
  'Free-text reason a blocked task is blocked, shown on the task detail sheet whenever tasks.status case-insensitively equals "blocked", and surfaced via a small icon+tooltip on the board card and list row. Null when no reason has been recorded.';
