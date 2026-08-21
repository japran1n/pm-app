-- F163: task_watchers table + RLS (AS-293)
--
-- Lets a user "watch" a task they are not necessarily assigned to, so they
-- receive notifications on activity (consumed by later features, e.g.
-- F207's fan-out and F231's "tasks I watch" view). Shape per the clarified
-- "data shape" answer: snake_case columns, uuid PK components, timestamptz
-- created_at; task_id + user_id form the composite primary key (also
-- enforces "a user can only watch a task once").
--
-- Access control (per the clarified "auth" answer): SELECT is scoped
-- through public.is_task_visible_to(task_id), same as task_assignees
-- (F159) and checklist_items (F132) -- a watcher row is only readable by
-- someone who can see the task. INSERT/DELETE are narrower than
-- task_assignees: the feature spec explicitly says "a user may only
-- insert/delete their own watcher row, except for the automatic paths in
-- F164" -- so write policies additionally require user_id = auth.uid(),
-- on top of task visibility. There is no self-serve "watch on behalf of
-- someone else" path in this feature; F164 (auto-watch on
-- assign/comment) is expected to use a SECURITY DEFINER trigger or the
-- service role rather than a relaxed RLS predicate here, so this
-- migration does not add one -- keeping this feature's policy surface
-- exactly as narrow as the spec asks for.
--
-- Ambiguity resolution (per clarified spec's own open question, "should
-- assignment auto-watch as well as commenting?"): deferred entirely to
-- F164, per the simplest-option default -- this migration only builds the
-- table and the self-serve watch/unwatch path (AS-293), it does not add
-- any auto-watch trigger itself.
--
-- Indexes (per the clarified "performance" answer): task_id is already the
-- leading column of the primary key (covers "who's watching this task").
-- A second index on user_id covers the "tasks I watch" query used by My
-- Tasks (F231).

create table if not exists task_watchers (
  task_id uuid not null references tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists task_watchers_user_id_idx on task_watchers (user_id);

comment on table task_watchers is
  'Users watching a task for activity notifications. Introduced by F163. '
  'A user may only insert/delete their own watcher row (self-serve '
  'watch/unwatch, AS-293); automatic watch paths (e.g. on assignment or '
  'commenting) are deferred to F164 and are expected to run as a '
  'SECURITY DEFINER trigger or via the service role rather than a relaxed '
  'RLS predicate on this table.';

alter table task_watchers enable row level security;

drop policy if exists task_watchers_select_visible on task_watchers;
create policy task_watchers_select_visible
  on task_watchers
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  );

drop policy if exists task_watchers_insert_self on task_watchers;
create policy task_watchers_insert_self
  on task_watchers
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_task_visible_to(task_id)
  );

drop policy if exists task_watchers_delete_self on task_watchers;
create policy task_watchers_delete_self
  on task_watchers
  for delete
  to authenticated
  using (
    user_id = auth.uid()
  );
