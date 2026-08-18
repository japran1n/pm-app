-- F064: attachments schema + private Storage bucket + RLS (AS-106, AS-107)
--
-- attachments -> tasks -> projects -> workspace_members: same join depth as
-- F058's comments table. Reuses public.is_task_workspace_member(task_id)
-- defined in that migration rather than duplicating the helper.
--
-- No soft-delete on this table (per this feature's spec): F067 will
-- hard-delete both the attachments row and the Storage object together, so
-- there is no deleted_at column and no filtering on one.
--
-- Storage path convention (binding for F065/F067, documented here since
-- this migration establishes it):
--   Objects live in the `task-attachments` bucket at the path
--     {task_id}/{uuid-or-filename}
--   i.e. storage.objects.name starts with the owning task's id as its first
--   path segment. attachments.file_url stores this same object path (NOT a
--   public URL) so the app can request a signed URL for it on demand.
--
-- Authorization approach for storage.objects (AS-106, AS-107): rather than
-- parsing the workspace out of the path, policies join storage.objects back
-- to the `attachments` table on file_url = objects.name (scoped to this
-- bucket), then reuse is_task_workspace_member(attachments.task_id). This
-- keeps a single source of truth for "who can see this task's data" instead
-- of a second, path-parsing implementation of the same rule. It requires
-- that an attachments row exists before the object is readable/writable via
-- RLS, which matches the intended flow (F065 inserts the attachments row as
-- part of the same upload transaction as the Storage write).

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id),
  file_url text not null,
  file_name text not null,
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint attachments_file_url_not_empty check (btrim(file_url) <> ''),
  constraint attachments_file_name_not_empty check (btrim(file_name) <> '')
);

-- Index strategy: index the FK/lookup column this table's RLS policy joins
-- through (same convention as comments.task_id / tasks.project_id).
create index if not exists attachments_task_id_idx on attachments (task_id);

alter table attachments enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as comments/tasks/projects —
-- the app never connects as the table owner for reads; privileged
-- server-side access goes through the secret key, which bypasses RLS by
-- design.

-- SELECT: any active member of the workspace that (transitively) owns the
-- attachment's task (AS-105/AS-109 read path).
create policy attachments_select_active_members
  on attachments
  for select
  to authenticated
  using (
    public.is_task_workspace_member(task_id)
  );

-- INSERT: any active member of the target task's workspace may attach a
-- file. with check re-validates task_id on the incoming row so a member of
-- workspace A cannot insert an attachments row claiming a task_id that
-- belongs to workspace B.
create policy attachments_insert_active_members
  on attachments
  for insert
  to authenticated
  with check (
    public.is_task_workspace_member(task_id)
  );

-- No UPDATE/DELETE policy in this migration: AS-110/AS-111 (uploader-or-
-- admin delete authorization) are out of scope for F064 and belong to a
-- later feature (mirrors F058 -> F061's split for comments). Absence of a
-- policy denies those operations by default under RLS.
--
-- No policy is created for anon or for authenticated non-members: absence
-- of a matching policy means those rows are simply not returned/writable
-- (RLS default deny).

-- ---------------------------------------------------------------------
-- Private Storage bucket (AS-106, AS-107)
-- ---------------------------------------------------------------------

-- Declarative bucket creation via storage.buckets, per Supabase's
-- documented convention for reproducible migrations (avoids a manual
-- dashboard click). public = false keeps the bucket private: objects are
-- never served from a public URL and are never listable anonymously.
insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

-- SELECT (download/signed URL generation) on storage.objects: only allowed
-- when the caller is an active member of the workspace that owns the task
-- the object belongs to, per the attachments-table join described above.
-- This is what makes AS-107 hold even if a non-member guesses the exact
-- storage path: without a matching, authorized attachments row, storage
-- .objects RLS denies the read, so createSignedUrl() fails for them.
create policy attachments_objects_select_active_members
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and exists (
      select 1
      from attachments a
      where a.file_url = storage.objects.name
        and public.is_task_workspace_member(a.task_id)
    )
  );

-- INSERT (upload) on storage.objects: the app's upload flow (F065) writes
-- the attachments row and the Storage object as part of the same request.
-- Since the attachments row doesn't exist yet at the moment of the Storage
-- write, this policy authorizes the upload by parsing the task_id out of
-- the object path's first segment ({task_id}/{filename}) and checking
-- workspace membership on that task directly, rather than joining through
-- attachments. F065 must upload to a path whose first segment is the
-- target task's id for this policy to allow the write.
create policy attachments_objects_insert_active_members
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'task-attachments'
    and public.is_task_workspace_member(
      (nullif(split_part(storage.objects.name, '/', 1), ''))::uuid
    )
  );

-- No UPDATE/DELETE policy on storage.objects in this migration: object
-- deletion is paired with the attachments row delete in F067 (AS-110/
-- AS-111), which is out of scope here. Absence of a policy denies those
-- operations by default under RLS.
