-- Drops the task_id column from calendar_blocks.
-- The Planner no longer shows tasks (product decision 2.5c).
-- Removing the column also removes the task→block delete cascade (AS-041).

drop index if exists calendar_blocks_task_id_idx;

alter table public.calendar_blocks
  drop column if exists task_id;
