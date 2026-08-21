-- F164: durable unwatch + self-serve watch/unwatch actions (AS-295, AS-296)
--
-- Design decision (recorded in full in the F164 handoff's Decisions made):
-- a plain delete-on-unwatch would be indistinguishable from "never
-- watched", so a later auto-watch-on-comment insert would silently
-- resurrect a watcher who explicitly opted out. Additive fix: keep the row
-- and add a boolean `is_watching` flag (default true) instead of deleting
-- it. Unwatch now flips the flag to false rather than removing the row;
-- watch flips it back to true. Auto-watch-on-comment then becomes a plain
-- `insert ... on conflict (task_id, user_id) do nothing` -- if a row
-- already exists (watching or explicitly unwatched), the insert is a
-- no-op and the existing state (including an explicit opt-out) is left
-- untouched. Only a genuinely new commenter (no row at all) gets inserted
-- as watching=true.
--
-- Additive per this mission's migration-safety convention: no column is
-- dropped, the existing self-serve INSERT/DELETE/SELECT policies from
-- F163 (20260822040000_task_watchers.sql) are left in place unchanged.
-- DELETE is kept for possible future cleanup use but the watch/unwatch
-- actions in this feature use insert/update, never delete, so that the
-- "explicitly unwatched" signal is never lost.

alter table task_watchers
  add column if not exists is_watching boolean not null default true;

comment on column task_watchers.is_watching is
  'true = actively watching, false = explicitly unwatched. The row itself '
  'existing (regardless of this flag) means "has an opinion about this '
  'task" -- introduced by F164 so that an explicit unwatch survives a '
  'later auto-watch-on-comment insert (which uses ON CONFLICT DO NOTHING '
  'and therefore never overwrites an existing row, explicit-opt-out or '
  'not). Watching state for notification fan-out should always be read as '
  '`is_watching = true`, never "row exists".';

-- New: self may UPDATE their own watcher row (needed for watchTask to
-- re-enable watching, and for unwatchTask to flip is_watching to false,
-- both via upsert from the authenticated session per the clarified "state
-- location" answer -- Postgres RLS treats `insert ... on conflict ...
-- do update` as needing both INSERT and UPDATE privileges on the
-- respective paths).
drop policy if exists task_watchers_update_self on task_watchers;
create policy task_watchers_update_self
  on task_watchers
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
