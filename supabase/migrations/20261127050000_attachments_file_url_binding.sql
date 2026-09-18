-- P2-32: bind attachments.file_url to the owning task's storage path.
--
-- Problem: the INSERT RLS policy on `attachments`
-- (attachments_insert_active_members, last set by
-- 20260821194500_viewer_guest_write_rls.sql) only checked that the
-- caller is an active writer in the task's workspace. It did NOT verify
-- that `file_url` actually starts with the target task's id, so a workspace
-- member could INSERT an attachments row whose file_url points to a different
-- task's storage objects (cross-task attachment injection).
--
-- Storage path convention (established in 20260818050100_create_attachments.sql):
--   Objects in the `task-attachments` bucket are stored at
--     {task_id}/{uuid-or-filename}
--   attachments.file_url stores this path (not a public URL).
--   The bucket also holds approval snapshots and improvement images for the
--   portal features; those follow the same {task_id}/... convention.
--
-- Fix: add `file_url LIKE (task_id::text || '/%')` to the INSERT WITH CHECK.
-- This ensures every attachments row's file_url is scoped to its own task's
-- storage directory, preventing a legitimate workspace member from inserting
-- a row that references another task's files.
--
-- No UPDATE policy exists on `attachments` (there is no
-- attachments_update_* policy in any migration -- see
-- 20260818050100_create_attachments.sql's "No UPDATE/DELETE policy in this
-- migration" comment). If an UPDATE policy is added in the future it must
-- include the same `file_url LIKE (task_id::text || '/%')` condition in its
-- WITH CHECK clause.

drop policy if exists attachments_insert_active_members on attachments;
create policy attachments_insert_active_members
  on attachments
  for insert
  to authenticated
  with check (
    -- The caller must be an active, non-viewer/guest member of the
    -- workspace that owns the target task (same check as before this fix).
    public.is_task_workspace_writer(task_id)
    -- Additionally, the file_url must be scoped to this task's own storage
    -- path ({task_id}/...) to prevent cross-task attachment injection.
    -- Cast to text is safe: task_id is a uuid, and uuid::text produces the
    -- lowercase hyphenated form Postgres always uses, which is also the
    -- form the application writes into the storage path.
    and file_url like (task_id::text || '/%')
  );

comment on table attachments is
  'F064/P2-32: task file attachments. file_url stores the storage object path '
  'in the format {task_id}/{filename}. The INSERT RLS policy enforces that '
  'file_url starts with task_id to prevent cross-task attachment injection.';
