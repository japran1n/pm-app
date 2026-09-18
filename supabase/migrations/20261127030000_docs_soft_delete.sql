-- P1-4: docs soft delete.
--
-- `deleteDoc` (lib/actions/docs.ts) previously did a hard
-- `.delete().eq("id", docId)` — documents have no `deleted_at` column, so a
-- deletion is permanent with no undo. The task trash (components/trash/,
-- 20260822200000_trash_deleted_by.sql) only covers `tasks`/`comments`.
-- This migration brings `docs` onto the SAME soft-delete convention
-- tasks/projects already use (tech-decisions.md: "deleted_at IS NULL" is
-- this codebase's one established soft-delete/archive convention) —
-- `deleted_at` is the delete timestamp, `archived_by` records who deleted
-- it, mirroring `projects.archived_by`
-- (20260822000000_projects_archived_by.sql) and `tasks.deleted_by`
-- (20260822200000_trash_deleted_by.sql) exactly, including the same
-- "additive only, nothing backfilled for pre-existing rows" posture.
--
-- No restore/trash-view UI is added here (out of scope for this fix) — this
-- migration only stops the data loss at the schema + RLS layer. A future
-- feature can extend components/trash/ to cover docs using these same two
-- columns.

alter table public.docs add column if not exists deleted_at timestamptz;
alter table public.docs add column if not exists archived_by uuid references auth.users (id);

comment on column public.docs.deleted_at is
  'Soft-delete timestamp, set by deleteDoc() (lib/actions/docs.ts). NULL means the doc is live. Same convention as tasks.deleted_at / projects.deleted_at.';

comment on column public.docs.archived_by is
  'The user who soft-deleted this doc, set by deleteDoc() in the same update that sets deleted_at. NULL for docs that are not deleted. Mirrors projects.archived_by (20260822000000_projects_archived_by.sql) and tasks.deleted_by (20260822200000_trash_deleted_by.sql).';

-- ---------------------------------------------------------------------
-- RLS: exclude soft-deleted rows from every existing SELECT policy on
-- docs, same shape as tasks_select_active_members
-- (20260818013805_rls_tasks.sql: "deleted_at is null and ..."). Both
-- policies are redefined here verbatim from their current shape
-- (20260905030000_docs_rls_role_restrictions.sql /
-- 20261014010000_f022_links_accounts_docs_visibility.sql) with only the
-- `deleted_at is null` conjunct added — no other predicate changes.
-- ---------------------------------------------------------------------

drop policy if exists docs_select_active_members on docs;
create policy docs_select_active_members
  on docs
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_active_workspace_member(workspace_id)
    and public.can_read_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists docs_select_client on docs;
create policy docs_select_client
  on docs
  for select
  to authenticated
  using (
    deleted_at is null
    and client_visible
    and project_id is not null
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

-- UPDATE: same "deleted_at is null" exclusion in the USING clause as
-- tasks_update_active_members, so a soft-deleted doc can no longer be
-- edited through the same action that would previously have found it via
-- a hard-deleted (nonexistent) row. `with check` is left unchanged — a
-- future restore action legitimately needs to write `deleted_at = null`
-- on a currently-deleted row, and USING alone already stops any OTHER
-- field of a deleted doc from being edited.
drop policy if exists docs_update_active_members on docs;
create policy docs_update_active_members
  on docs
  for update
  to authenticated
  using (
    deleted_at is null
    and public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

-- No DELETE policy is removed: `docs_delete_active_members` stays in place
-- so an admin/future purge tool can still issue a real hard DELETE through
-- server-side privileged access if ever needed — the app itself no longer
-- calls it (deleteDoc() now issues an UPDATE, not a DELETE).
