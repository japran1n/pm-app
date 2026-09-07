-- Consolidation: quick_notes (20261110010000) duplicated personal_todos
-- (20260903020000) — same "strictly personal, owner-only" entity, differing
-- only in that quick_notes could optionally link to a task or project. This
-- migration folds that one capability into personal_todos instead of
-- keeping two parallel tables; the quick_notes table itself is dropped in
-- the companion migration (20261116020000).

alter table personal_todos
  add column if not exists task_id uuid references tasks (id) on delete set null,
  add column if not exists project_id uuid references projects (id) on delete set null;

create index if not exists personal_todos_task_id_idx
  on personal_todos (task_id) where task_id is not null;
create index if not exists personal_todos_project_id_idx
  on personal_todos (project_id) where project_id is not null;
