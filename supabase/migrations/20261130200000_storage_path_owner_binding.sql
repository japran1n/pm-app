-- Bind every user-writable storage path column to its owning row.
--
-- Signing and removal of these objects run on the service-role client,
-- which skips storage.objects RLS. Any row a workspace writer can insert or
-- update could therefore point at another tenant's object and get it signed
-- (or deleted) on its behalf. The application now refuses paths outside the
-- owner folder (lib/storage/sign-owned-object.ts); these constraints make
-- the same rule hold for every writer, including raw PostgREST calls.
--
-- Canonical prefixes, as written at upload time:
--   attachments.file_url                       task-attachments   {task_id}/...
--   message_attachments.storage_path           chat-attachments   {channel_id}/...
--   project_scope_documents.file_path          scope-documents    {project_id}/...
--   project_improvements.before_path/after_path task-attachments  improvements/{project_id}/...
--   approval_requests.artifact_snapshot_path   task-attachments   approval-requests/{id}/...
--
-- Correction to 20261127050000_attachments_file_url_binding.sql: approval
-- snapshots and improvement images do NOT follow {task_id}/...; they use the
-- approval-requests/ and improvements/ prefixes listed above.
--
-- All owner ids live on the row itself, so plain CHECK constraints suffice
-- (moving a row to another owner without moving its path is rejected too).

create or replace function public.storage_path_is_owned(path text, owner_prefix text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select path is null or (
    owner_prefix like '%/'
    and length(path) > length(owner_prefix)
    and left(path, length(owner_prefix)) = owner_prefix
    and left(path, 1) <> '/'
    and strpos(path, chr(92)) = 0
    and strpos(path, '//') = 0
    and right(path, 1) <> '/'
    and path !~ '(^|/)\.\.?(/|$)'
  );
$$;

comment on function public.storage_path_is_owned(text, text) is
  'True when path is null, or a traversal-free object key under owner_prefix (which must end in /).';

-- New functions get no default EXECUTE here; every role that writes these
-- tables evaluates the constraints below.
grant execute on function public.storage_path_is_owned(text, text) to anon, authenticated, service_role;

alter table public.attachments
  add constraint attachments_file_url_owned
  check (public.storage_path_is_owned(file_url, task_id::text || '/')) not valid;

alter table public.message_attachments
  add constraint message_attachments_storage_path_owned
  check (public.storage_path_is_owned(storage_path, channel_id::text || '/')) not valid;

alter table public.project_scope_documents
  add constraint project_scope_documents_file_path_owned
  check (public.storage_path_is_owned(file_path, project_id::text || '/')) not valid;

alter table public.project_improvements
  add constraint project_improvements_before_path_owned
  check (public.storage_path_is_owned(before_path, 'improvements/' || project_id::text || '/')) not valid;

alter table public.project_improvements
  add constraint project_improvements_after_path_owned
  check (public.storage_path_is_owned(after_path, 'improvements/' || project_id::text || '/')) not valid;

alter table public.approval_requests
  add constraint approval_requests_artifact_snapshot_path_owned
  check (public.storage_path_is_owned(artifact_snapshot_path, 'approval-requests/' || id::text || '/')) not valid;

-- Existing rows were checked before this migration and all conform.
alter table public.attachments validate constraint attachments_file_url_owned;
alter table public.message_attachments validate constraint message_attachments_storage_path_owned;
alter table public.project_scope_documents validate constraint project_scope_documents_file_path_owned;
alter table public.project_improvements validate constraint project_improvements_before_path_owned;
alter table public.project_improvements validate constraint project_improvements_after_path_owned;
alter table public.approval_requests validate constraint approval_requests_artifact_snapshot_path_owned;
