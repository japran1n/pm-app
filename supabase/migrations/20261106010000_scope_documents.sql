-- Scope & Decisions attachments: lets the team attach a document (upload)
-- or a link (e.g. a Figma proposal, a contract stored elsewhere) to a
-- project's Scope & Decisions portal page.
--
-- No general-purpose attachment table exists to reuse here: `attachments`
-- (20260818050100) is hard task-scoped — both its RLS and its Storage
-- object-path convention key off `task_id`, not `project_id`, and it has
-- no notion of an external link at all (upload only). Rather than bend
-- that table (and its Storage policies, which parse a task uuid out of
-- the object path's first segment) to a project-scoped, upload-or-link
-- shape it was never designed for, this migration introduces a small,
-- dedicated table that follows the SAME conventions the rest of the
-- portal's project-scoped tables already use (project_scope_items,
-- project_decisions, project_links, project_accounts — 20260926010000,
-- 20261014010000): `is_project_visible_to`, `is_project_client`,
-- `is_project_portal_enabled`, `is_project_workspace_writer`.
--
-- Client SELECT policy deliberately includes ALL FOUR conjuncts —
-- membership (via is_project_visible_to), ROLE (is_project_client), and
-- portal_enabled — not just a membership check. This is the exact shape
-- 20261014010000's docs_select_client policy exists to add (that
-- migration's own header comment: 20260905020000/20260905030000 had to
-- close a real leak where a docs policy checked membership only and not
-- role). Getting this wrong here would let a non-client team member's
-- policy path fall through to the client policy and see documents the
-- team-only policy already covers via a separate, correctly-scoped rule,
-- or worse, let a client of a portal-disabled project read documents.
--
-- No `client_visible` column: like project_scope_items and
-- client_deliverables (20260926010000's own header comment), everything
-- a PM attaches here — a signed contract, a Figma proposal link — is, by
-- definition, a client-facing artefact for THIS page. There is no
-- internal-only variant of "a document attached to the client-visible
-- scope page" to hide.

create table if not exists project_scope_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  kind text not null,
  file_path text,
  url text,
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint project_scope_documents_title_not_empty check (btrim(title) <> ''),
  constraint project_scope_documents_kind_check check (kind in ('upload', 'link')),
  -- Exactly one of file_path (upload) / url (link) is set, matching the
  -- table's own kind.
  constraint project_scope_documents_shape_check check (
    (kind = 'upload' and file_path is not null and btrim(file_path) <> '' and url is null)
    or
    (kind = 'link' and url is not null and btrim(url) <> '' and file_path is null)
  )
);

create index if not exists project_scope_documents_project_id_created_at_idx
  on project_scope_documents (project_id, created_at desc);

alter table project_scope_documents enable row level security;

-- Team: same "visible to me and I'm not a client" shape every
-- project-scoped team table in this schema uses.
drop policy if exists project_scope_documents_select_team on project_scope_documents;
create policy project_scope_documents_select_team
  on project_scope_documents
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

-- Client: membership + ROLE + portal_enabled (see this migration's header
-- comment on why the role conjunct is required, not optional).
drop policy if exists project_scope_documents_select_client on project_scope_documents;
create policy project_scope_documents_select_client
  on project_scope_documents
  for select
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

-- Every write is a team write — a client can view but never attach or
-- remove a scope document, same as every other table in this file's
-- reference set.
drop policy if exists project_scope_documents_insert_team on project_scope_documents;
create policy project_scope_documents_insert_team
  on project_scope_documents
  for insert
  to authenticated
  with check (
    public.is_project_workspace_writer(project_id)
    and uploaded_by = auth.uid()
  );

drop policy if exists project_scope_documents_delete_team on project_scope_documents;
create policy project_scope_documents_delete_team
  on project_scope_documents
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- No UPDATE policy: a document/link is created or deleted, never edited
-- in place — same "no edit, only add/remove" shape as attachments.

-- ---------------------------------------------------------------------
-- Private Storage bucket for the 'upload' kind
-- ---------------------------------------------------------------------
-- Object path convention: {project_id}/{uuid-or-filename} — the project
-- id is the first path segment, mirroring task-attachments' own
-- {task_id}/{filename} convention (20260818050100), adapted from task to
-- project scope since this table has no task_id at all.

insert into storage.buckets (id, name, public)
values ('scope-documents', 'scope-documents', false)
on conflict (id) do nothing;

-- SELECT: only when a project_scope_documents row references this exact
-- object path AND the caller passes the same team-or-client visibility
-- rule the table's own SELECT policies enforce. This is defense in depth
-- only — the app's read path (getScopeDocumentSignedUrl) mints signed
-- URLs with the admin client, which bypasses this policy the same way
-- getAttachmentSignedUrl does for task-attachments.
drop policy if exists scope_documents_objects_select on storage.objects;
create policy scope_documents_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'scope-documents'
    and exists (
      select 1
      from project_scope_documents d
      where d.file_path = storage.objects.name
        and (
          (
            public.is_project_visible_to(d.project_id)
            and not public.is_project_client(d.project_id)
          )
          or (
            public.is_project_client(d.project_id)
            and public.is_project_visible_to(d.project_id)
            and public.is_project_portal_enabled(d.project_id)
          )
        )
    )
  );

-- INSERT (upload): the project_scope_documents row does not exist yet at
-- upload time (same ordering as F065's uploadAttachmentForUser: Storage
-- write happens before the row insert), so this policy parses the
-- project id out of the object path's first segment and checks
-- is_project_workspace_writer directly, exactly like
-- attachments_objects_insert_active_members does for task-attachments.
drop policy if exists scope_documents_objects_insert on storage.objects;
create policy scope_documents_objects_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'scope-documents'
    and public.is_project_workspace_writer(
      (nullif(split_part(storage.objects.name, '/', 1), ''))::uuid
    )
  );

-- DELETE: paired with the project_scope_documents row delete in the
-- server action, via the admin client (bypasses this policy). No
-- authenticated-role DELETE policy is added — absence denies direct
-- client-side deletes of the object by default under RLS, same
-- "no policy = default deny" convention as task-attachments.
