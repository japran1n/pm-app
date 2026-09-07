-- Quick notes: a lighter, smaller entity than a personal to-do
-- (personal_todos, 20260903020000) or a task/subtask/checklist item. A
-- "don't forget" jotted note, always strictly personal (owner-only, never
-- shared — same RLS shape as personal_todos, no workspace-admin escape
-- hatch), optionally pinned to a task or project for context but never
-- required to be. Lives on the workspace dashboard for maximum visibility,
-- not tucked away on the My Work page.

create table if not exists quick_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  task_id uuid references tasks (id) on delete set null,
  project_id uuid references projects (id) on delete set null,
  text text not null,
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint quick_notes_text_not_empty check (btrim(text) <> ''),
  constraint quick_notes_text_length check (char_length(text) <= 280)
);

create index if not exists quick_notes_user_id_workspace_id_idx
  on quick_notes (user_id, workspace_id);
create index if not exists quick_notes_task_id_idx
  on quick_notes (task_id) where task_id is not null;
create index if not exists quick_notes_project_id_idx
  on quick_notes (project_id) where project_id is not null;

alter table quick_notes enable row level security;

-- Owner-only visibility: a quick note is a personal reminder, not
-- workspace data, mirroring personal_todos_owner_only exactly — no
-- membership or admin branch, even when task_id/project_id links it to
-- shared workspace data.
drop policy if exists quick_notes_owner_only on quick_notes;
create policy quick_notes_owner_only
  on quick_notes
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
