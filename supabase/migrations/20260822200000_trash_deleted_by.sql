-- F188: trash view (AS-343, AS-347, AS-352).
--
-- "By whom" (AS-347): `tasks` and `comments` have `deleted_at` (mission-1)
-- but no actor-tracking column, confirmed via
-- `lib/supabase/database.types.ts`'s generated Row types for both tables
-- (only `deleted_at`, no `deleted_by`) before writing this migration —
-- mirrors F142's own `archived_by` precedent (that migration's doc
-- comment explains at length why a separate audit_log lookup isn't an
-- acceptable substitute: audit writes are documented best-effort/
-- non-fatal, not a reliable source for a view that must show "by whom"
-- every time). Additive only, per this mission's "additive first"
-- migration convention: a new nullable column on each table, nothing
-- dropped, nothing backfilled with a guess for already-deleted rows
-- (there is no way to know who deleted a pre-existing deleted row before
-- this column existed — it stays NULL and the trash UI handles that
-- explicitly, same convention as F142's `archived_by`).
alter table tasks
  add column if not exists deleted_by uuid references auth.users (id);

comment on column tasks.deleted_by is
  'F188/AS-347: the user who soft-deleted this task, set by deleteTask()/bulkDeleteTasks() in the same update that sets deleted_at. NULL for tasks deleted before this column existed, tasks cascade-deleted as a side effect of a parent delete (deliberately not attributed to the actor who deleted the parent — see lib/actions/tasks.ts), or tasks that are not deleted.';

alter table comments
  add column if not exists deleted_by uuid references auth.users (id);

comment on column comments.deleted_by is
  'F188/AS-347: the user who soft-deleted this comment, set by deleteComment() in the same update that sets deleted_at. NULL for comments deleted before this column existed, or comments that are not deleted.';

-- ---------------------------------------------------------------------
-- RLS: trash rows (deleted_at IS NOT NULL) must obey the SAME
-- project-visibility rules as live rows (AS-352 + this feature's
-- Clarified/Notes instruction: "reuse is_task_visible_to/
-- is_project_visible_to, don't invent a parallel check"). The existing
-- `tasks_select_active_members` / `comments_select_active_members`
-- policies (supabase/migrations/20260821140526_project_visibility_rls_
-- sweep.sql, since updated in place by 20260821193618_guest_role_scoping.
-- sql) both filter `deleted_at is null`, so they never match a trashed
-- row — a second, additive SELECT policy is required (Postgres ORs
-- multiple permissive policies for the same command together). Each new
-- policy calls the exact same `is_project_visible_to`/`is_task_visible_to`
-- functions the live-row policies call, so a private project's trashed
-- tasks/comments are invisible to a non-member for the identical reason
-- its live tasks/comments already are — no parallel visibility rule is
-- introduced.
-- ---------------------------------------------------------------------

drop policy if exists tasks_select_trash_visible_members on tasks;
create policy tasks_select_trash_visible_members
  on tasks
  for select
  to authenticated
  using (
    deleted_at is not null
    and public.is_project_visible_to(project_id)
  );

drop policy if exists comments_select_trash_visible_members on comments;
create policy comments_select_trash_visible_members
  on comments
  for select
  to authenticated
  using (
    deleted_at is not null
    and public.is_task_visible_to(task_id)
  );
