-- F416-F418 (docs/plan-daily-work-followups.md): personal to-dos.
--
-- Small, unassigned things — "call the domain registrar", "confirm launch
-- date with client" — don't deserve a full task (no assignee/status/board
-- column semantics apply), but get forgotten without SOME list. This is
-- that list: strictly personal, never shared, never visible to anyone but
-- its owner — not even a workspace owner/admin. A workspace_id scopes it
-- to "this is a task I'm tracking in the context of this workspace" (so
-- the My Work page in workspace A doesn't show a to-do jotted down while
-- looking at workspace B), but ownership alone is what RLS gates on.
--
-- Deliberately NOT built tonight: scheduled reminders (a due-at timestamp
-- that fires a notification via a NEW pg_cron job). That's real
-- additional infrastructure — a new scheduled job on a live, shared
-- database — and shipping one autonomously, overnight, with no one
-- watching it fire for the first time is a different risk class than an
-- ordinary CRUD table. Deferred to a session where its first firing can
-- be observed. This migration ships the plain to-do list, which is the
-- immediately useful core of the request.

create table if not exists personal_todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_todos_title_not_empty check (btrim(title) <> '')
);

create index if not exists personal_todos_user_id_workspace_id_idx
  on personal_todos (user_id, workspace_id);
create index if not exists personal_todos_user_id_workspace_id_position_idx
  on personal_todos (user_id, workspace_id, position);

drop trigger if exists personal_todos_set_updated_at on personal_todos;
create trigger personal_todos_set_updated_at
  before update on personal_todos
  for each row
  execute function set_updated_at();

alter table personal_todos enable row level security;

-- AS-563: visible ONLY to its owner. No workspace-membership branch, no
-- owner/admin override — unlike every other table in this schema, there
-- is deliberately no "workspace admin can see everything" escape hatch
-- here, because the whole point of a personal to-do is that it is not
-- workspace data.
drop policy if exists personal_todos_owner_only on personal_todos;
create policy personal_todos_owner_only
  on personal_todos
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
