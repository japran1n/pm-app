-- F033: tasks schema (no RLS yet — RLS is F034)
--
-- The core domain entity of the app. Covers AS-047, AS-048, AS-049, AS-050,
-- AS-058, AS-059, AS-065, AS-066.
--
-- Fixed-value columns (status, priority) use CHECK constraints rather than
-- native Postgres enums, per tech-decisions.md (avoids ALTER TYPE
-- transaction-limitation pain later when the value set needs to grow).
--
-- Learned from F100 (projects_name_not_empty gap): a `not null` column does
-- NOT reject an empty string. `title` gets an explicit non-empty-after-trim
-- CHECK here from the start, not bolted on later.

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  title text not null,
  description text,
  status text not null default 'todo',
  priority text,
  tags text[] not null default '{}',
  start_date date,
  due_date date,
  points integer,
  author_id uuid not null references auth.users (id),
  assignee_id uuid references auth.users (id),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- AS-047/AS-048: status must be one of the fixed set, enforced at the DB
  -- level so no bypass of the UI/Server Action layer can write an invalid
  -- value.
  constraint tasks_status_check check (
    status in ('todo', 'in_progress', 'in_review', 'done')
  ),
  -- AS-049/AS-050: priority is optional, but when present must be one of the
  -- fixed set — same DB-level guarantee as status.
  constraint tasks_priority_check check (
    priority is null
    or priority in ('urgent', 'high', 'medium', 'low', 'backlog')
  ),
  -- Non-empty-after-trim title, applied from the start (F100's lesson: a bare
  -- `not null` only rejects NULL, not '' or whitespace-only strings).
  constraint tasks_title_not_empty check (btrim(title) <> '')
);

-- Index strategy: index every FK/lookup column this table's RLS policy
-- (F034) will join through, per the migration-type clarification's Index
-- strategy answer. A composite (project_id, status) index is added on top
-- since board-column queries ("all tasks for project X in status Y") are
-- the most common read pattern once F044+ builds the Kanban board.
create index if not exists tasks_project_id_idx on tasks (project_id);
create index if not exists tasks_assignee_id_idx on tasks (assignee_id);
create index if not exists tasks_status_idx on tasks (status);
create index if not exists tasks_project_id_status_idx on tasks (project_id, status);

-- Reuses set_updated_at(), established in 20260818004413_create_projects.sql.
drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
  before update on tasks
  for each row
  execute function set_updated_at();
