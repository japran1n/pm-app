-- F046: AS-080 — dragging a task to reorder it within a column persists
-- the new `position` value but must NOT bump `updated_at` unless `status`
-- (or some other real field) also changed.
--
-- Investigated: the `tasks_set_updated_at` trigger from
-- 20260818013434_create_tasks.sql fires `before update ... for each row`
-- with no `WHEN` clause, so it unconditionally sets `new.updated_at =
-- now()` on *any* UPDATE — including a position-only reorder from
-- reorderTask (F046). Confirmed this is a real problem, not a hypothetical
-- one: an unconditional trigger would make AS-080 fail on every drag.
--
-- Fix: replace the trigger with an equivalent one gated by a WHEN clause
-- that only fires when a column *other than* `position` (and `updated_at`
-- itself) actually changed. A position-only UPDATE (reorderTask) no longer
-- touches `updated_at`; a status-changing UPDATE (moveTaskStatus) still
-- does, same as any other real edit (editTask, assignTask, deleteTask,
-- updateTaskTags).
drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
  before update on tasks
  for each row
  when (
    old.project_id is distinct from new.project_id
    or old.title is distinct from new.title
    or old.description is distinct from new.description
    or old.status is distinct from new.status
    or old.priority is distinct from new.priority
    or old.tags is distinct from new.tags
    or old.start_date is distinct from new.start_date
    or old.due_date is distinct from new.due_date
    or old.points is distinct from new.points
    or old.author_id is distinct from new.author_id
    or old.assignee_id is distinct from new.assignee_id
    or old.deleted_at is distinct from new.deleted_at
  )
  execute function set_updated_at();
