-- Add billable flag to tasks (default true = all existing tasks are billable)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS billable boolean NOT NULL DEFAULT true;
