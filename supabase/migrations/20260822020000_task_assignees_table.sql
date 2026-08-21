-- F159: task_assignees table + backfill (AS-286, AS-292)
--
-- A task can have more than one assignee (AS-286). Today `tasks.assignee_id`
-- is a single nullable FK to auth.users — this migration adds a proper
-- many-to-many join table without touching that column. Per this feature's
-- clarified scope, `tasks.assignee_id` stays in place, unchanged, and is
-- only marked deprecated in a comment; it is not dropped here (that is the
-- dedicated cleanup feature F270's job, after F160/F161/F162 land and every
-- reader has moved off the old column).
--
-- Shape (per the clarified "data shape" answer): snake_case columns,
-- uuid PK components, timestamptz created_at. `task_id`/`user_id` form the
-- composite primary key (also enforces "no duplicate assignment of the
-- same user to the same task"). `assigned_by` records who made the
-- assignment (nullable — the backfill below has no "who did it" data for
-- the original single-assignee sets, so it is left null for backfilled
-- rows rather than guessing an actor).
--
-- Access control (per the clarified "auth" answer and F132's handoff,
-- which explicitly asks the next task_assignees worker to route through
-- is_task_visible_to from the start rather than reintroducing
-- is_task_workspace_member): every policy (SELECT, INSERT, UPDATE, DELETE)
-- is scoped through public.is_task_visible_to(task_id), the same helper
-- and the same full-CRUD-sweep pattern F132 used for checklist_items —
-- so a private project's assignees are neither readable nor writable by a
-- workspace member who isn't an explicit project member. There is no
-- separate "assignment permission" rule named anywhere in the clarified
-- spec beyond project visibility, so per the ambiguity-resolution default
-- (simplest option, no second source of truth) any caller who can see the
-- task can also assign/unassign on it — the same permission boundary this
-- codebase already uses for tasks.assignee_id writes (lib/actions/tasks.ts
-- reassignTask only requires task visibility/membership, not a separate
-- "can assign" role).
--
-- Indexes (per the clarified "performance" answer): task_id is already the
-- leading column of the primary key (covers "who's assigned to this
-- task"); a second index on user_id covers "what am I assigned to".

create table if not exists task_assignees (
  task_id uuid not null references tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  assigned_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists task_assignees_user_id_idx on task_assignees (user_id);

comment on table task_assignees is
  'Many-to-many task assignment. Introduced by F159 alongside the legacy '
  'tasks.assignee_id single-assignee column (see comment on that column) '
  '-- both are populated for existing data via a one-time backfill in this '
  'same migration; new assignment writes should prefer this table.';

comment on column tasks.assignee_id is
  'DEPRECATED (F159): superseded by the task_assignees join table, which '
  'supports multiple assignees per task. Kept in place, unchanged, until '
  'every reader has migrated (see F160/F161/F162) and the dedicated '
  'cleanup feature (F270) removes it. Do not add new writers of this '
  'column; write to task_assignees instead.';

alter table task_assignees enable row level security;

drop policy if exists task_assignees_select_visible on task_assignees;
create policy task_assignees_select_visible
  on task_assignees
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  );

drop policy if exists task_assignees_insert_visible on task_assignees;
create policy task_assignees_insert_visible
  on task_assignees
  for insert
  to authenticated
  with check (
    public.is_task_visible_to(task_id)
  );

drop policy if exists task_assignees_update_visible on task_assignees;
create policy task_assignees_update_visible
  on task_assignees
  for update
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  )
  with check (
    public.is_task_visible_to(task_id)
  );

drop policy if exists task_assignees_delete_visible on task_assignees;
create policy task_assignees_delete_visible
  on task_assignees
  for delete
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  );

-- One-time backfill: every existing tasks.assignee_id becomes a real row
-- here (AS-292). `on conflict do nothing` makes this migration safely
-- re-runnable. `assigned_by` is left null for backfilled rows (see header
-- comment above -- no historical "who assigned this" data exists for the
-- legacy single-assignee column).
insert into task_assignees (task_id, user_id, assigned_by, created_at)
select t.id, t.assignee_id, null, t.created_at
from tasks t
where t.assignee_id is not null
on conflict (task_id, user_id) do nothing;
