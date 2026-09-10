-- Mission 20260910-182104, F002: page_components table and two task
-- columns. Architecture module standing decision 1 (clarifications/
-- standing-decisions.md): a page IS a task with `page_slug` set, a
-- section IS that task's subtask. `page_components` is the new entity
-- this feature introduces so a section can be linked to a reusable
-- component (AS-062, AS-063, AS-065, AS-066); the link itself lives as a
-- single nullable FK column on `tasks`, never a join table, because a
-- section can point at *at most one* component.
--
-- Existing objects this migration relies on (verified live via the
-- Supabase MCP against project qcipqonnqajmazdbysow immediately before
-- writing this file, not from memory):
--   * `tasks.project_id`, `tasks.page_slug`, `tasks.page_order`,
--     `tasks.phase_id`, `tasks.parent_task_id`, `tasks.task_type_id`
--     (20260909010000_portal_foundations.sql,
--     20260819071050_subtasks_parent_task_id.sql) — all present.
--   * `task_types.system_key` check constraint
--     (20261104010000_f116_task_type_taxonomy.sql) — present; this
--     migration does not touch `task_types`.
--   * `set_updated_at()` trigger function — used by every other
--     updated_at-bearing table in this schema (e.g.
--     20260909010000_portal_foundations.sql's `project_phases`,
--     20261101020000_f113_page_links.sql's `page_links`); reused as-is.
--   * `projects` table (`projects.id`) — FK target for
--     `page_components.project_id`.
--
-- Standing decision 2 (clarifications/standing-decisions.md): NO
-- `parent_page_id` column anywhere. Page hierarchy lives only in the
-- slug text; the board is a flat row of columns. This migration does
-- not add any page-hierarchy column.
--
-- `page_kind` is only meaningful on a page (a task with `page_slug`
-- set) and `component_id` only meaningful on a section (a task that is
-- a subtask, i.e. has `parent_task_id` set), but per the exact
-- reasoning `20260909010000_portal_foundations.sql` already documents
-- for `page_slug`/`page_order` (lines ~9-12: "No constraint ties
-- `page_slug`/`page_order` to `task_type = 'page'` — a check that reads
-- another table isn't worth the trigger, per this feature's clarified
-- spec"), neither column below carries a CHECK or trigger that reads
-- another table to enforce that context. That guard belongs in the
-- application layer (lib/actions/, lib/validation/), same as its
-- sibling columns.
--
-- RLS: enabled on `page_components` so the table is never briefly open,
-- but no policies are written here — policies are F003, a separate
-- feature in this mission.

-- ---------------------------------------------------------------------
-- 1. page_components
-- ---------------------------------------------------------------------

create table if not exists page_components (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_components_name_not_empty check (btrim(name) <> '')
);

-- AS-065: two components in the same project cannot have the same name
-- (case-insensitive).
create unique index if not exists page_components_project_id_lower_name_idx
  on page_components (project_id, lower(name));

-- Matches project_phases (20260909010000) / other reorderable-position
-- columns: no unique(project_id, position), position is a sort key only.
create index if not exists page_components_project_id_position_idx
  on page_components (project_id, position);

drop trigger if exists page_components_set_updated_at on page_components;
create trigger page_components_set_updated_at
  before update on page_components
  for each row
  execute function set_updated_at();

alter table page_components enable row level security;

-- ---------------------------------------------------------------------
-- 2. tasks: page_kind, component_id
-- ---------------------------------------------------------------------

alter table tasks add column if not exists page_kind text;

alter table tasks
  drop constraint if exists tasks_page_kind_check,
  add constraint tasks_page_kind_check check (
    page_kind is null or page_kind in ('static', 'cms', 'utility')
  );

-- AS-062: a section can be linked to at most one component — enforced
-- by this being a single nullable scalar FK column, not a join table.
alter table tasks add column if not exists component_id uuid
  references page_components (id) on delete set null;

create index if not exists tasks_component_id_idx on tasks (component_id);
