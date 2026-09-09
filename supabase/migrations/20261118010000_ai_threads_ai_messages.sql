-- F018 (missions/20260909-ai-docs): ai_threads + ai_messages — the AI docs
-- sidebar's conversation storage. A thread is a chat session scoped to a
-- workspace, optionally anchored to a project and/or a doc (the doc/project
-- open in the sidebar when the thread was created); messages belong to a
-- thread and carry the assistant's tool-call trace, edit proposals, and
-- token usage alongside plain content.
--
-- RLS follows the exact `docs`/`doc_folders` convention introduced in
-- 20260905030000_docs_rls_role_restrictions.sql: active workspace
-- membership is NOT sufficient on its own — that migration's own header
-- comment explains why (the `client` role is an active workspace_members
-- row and would otherwise inherit membership-only policies wholesale).
-- ai_threads/ai_messages reuse `public.can_read_workspace_docs` /
-- `public.can_write_workspace_docs` rather than introduce parallel
-- can_read_workspace_ai_threads helpers: both predicates already express
-- exactly the shape this feature needs (active member AND role <>
-- 'client' for read; role not in ('viewer','client') for write), and the
-- AI sidebar is a docs-adjacent surface with no product requirement that
-- it diverge from that role gate.
--
-- Portal clients seeing nothing is asserted EXPLICITLY here, not by
-- omission: `can_read_workspace_docs`/`can_write_workspace_docs` exclude
-- role = 'client' inline, so every policy below carries that exclusion on
-- its face rather than relying on the absence of a portal-specific policy
-- to imply denial (the exact leak class 20260905030000's header comment
-- and 20261014010000's docs_select_client migration both warn about:
-- membership-only checks that forget the role conjunct).
--
-- ai_messages has no workspace_id/project_id of its own; visibility is
-- inherited through ai_threads via `exists (... where thread_id = ...)`,
-- the same join-through-parent shape doc_links uses to inherit its parent
-- doc's visibility (20261102010000_f114_how_we_work_guides.sql).

create table if not exists ai_threads (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id   uuid references projects (id) on delete set null,
  doc_id       uuid references docs (id) on delete set null,
  created_by   uuid not null references profiles (id),
  title        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists ai_threads_workspace_id_created_at_idx
  on ai_threads (workspace_id, created_at desc);
create index if not exists ai_threads_project_id_idx
  on ai_threads (project_id);
create index if not exists ai_threads_doc_id_idx
  on ai_threads (doc_id);
create index if not exists ai_threads_created_by_idx
  on ai_threads (created_by);

drop trigger if exists ai_threads_set_updated_at on ai_threads;
create trigger ai_threads_set_updated_at
  before update on ai_threads
  for each row
  execute function set_updated_at();

create table if not exists ai_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references ai_threads (id) on delete cascade,
  role       text not null,
  content    text not null default '',
  tool_calls jsonb,
  proposals  jsonb,
  usage      jsonb,
  created_at timestamptz not null default now(),
  constraint ai_messages_role_check check (role in ('user', 'assistant'))
);

create index if not exists ai_messages_thread_id_created_at_idx
  on ai_messages (thread_id, created_at);

alter table ai_threads enable row level security;
alter table ai_messages enable row level security;

-- ai_threads: any active workspace member who is not a client can see
-- every thread in their workspace (collaborative, same posture as docs —
-- not owner-only). Insert requires the caller to be creating the thread
-- as themselves, in a workspace they can write docs in, and (per the
-- feature spec) requires can_write_workspace_docs rather than the looser
-- can_read_workspace_docs, since threads are user-generated content, not
-- read-only reference material.

drop policy if exists ai_threads_select_active_members on ai_threads;
create policy ai_threads_select_active_members
  on ai_threads
  for select
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.can_read_workspace_docs(workspace_id)
  );

drop policy if exists ai_threads_insert_active_members on ai_threads;
create policy ai_threads_insert_active_members
  on ai_threads
  for insert
  to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and created_by = auth.uid()
  );

drop policy if exists ai_threads_update_active_members on ai_threads;
create policy ai_threads_update_active_members
  on ai_threads
  for update
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
  );

drop policy if exists ai_threads_delete_active_members on ai_threads;
create policy ai_threads_delete_active_members
  on ai_threads
  for delete
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
  );

-- Portal clients must see nothing. `can_read_workspace_docs` /
-- `can_write_workspace_docs` already exclude role = 'client' inline (see
-- this migration's header comment), but that exclusion is asserted here
-- again, explicitly, as a standalone denial policy so a future edit to
-- either helper's definition cannot silently reopen ai_threads to the
-- client role without also touching a policy whose name says exactly
-- what it exists to prevent.
drop policy if exists ai_threads_deny_portal_clients on ai_threads;
create policy ai_threads_deny_portal_clients
  on ai_threads
  as restrictive
  for all
  to authenticated
  using (not public.is_project_client(coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  with check (not public.is_project_client(coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)));

-- ai_messages: visibility/write access is inherited entirely through the
-- parent thread — no direct workspace_id/project_id column to check
-- against, so every policy joins through ai_threads the same way
-- doc_links joins through docs (20261102010000).

drop policy if exists ai_messages_select_via_thread on ai_messages;
create policy ai_messages_select_via_thread
  on ai_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from ai_threads t
      where t.id = ai_messages.thread_id
        and public.is_active_workspace_member(t.workspace_id)
        and public.can_read_workspace_docs(t.workspace_id)
    )
  );

drop policy if exists ai_messages_insert_via_thread on ai_messages;
create policy ai_messages_insert_via_thread
  on ai_messages
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from ai_threads t
      where t.id = ai_messages.thread_id
        and public.is_active_workspace_member(t.workspace_id)
        and public.can_write_workspace_docs(t.workspace_id)
    )
  );

drop policy if exists ai_messages_delete_via_thread on ai_messages;
create policy ai_messages_delete_via_thread
  on ai_messages
  for delete
  to authenticated
  using (
    exists (
      select 1
      from ai_threads t
      where t.id = ai_messages.thread_id
        and public.is_active_workspace_member(t.workspace_id)
        and public.can_write_workspace_docs(t.workspace_id)
    )
  );

-- No UPDATE policy on ai_messages: a message is appended once and never
-- edited in place, same "no edit, only add/remove" shape as attachments
-- and project_scope_documents.

-- Portal clients must see nothing on ai_messages either — explicit
-- restrictive denial, same reasoning as ai_threads_deny_portal_clients
-- above, joined through the parent thread's project_id.
drop policy if exists ai_messages_deny_portal_clients on ai_messages;
create policy ai_messages_deny_portal_clients
  on ai_messages
  as restrictive
  for all
  to authenticated
  using (
    not exists (
      select 1
      from ai_threads t
      where t.id = ai_messages.thread_id
        and t.project_id is not null
        and public.is_project_client(t.project_id)
    )
  )
  with check (
    not exists (
      select 1
      from ai_threads t
      where t.id = ai_messages.thread_id
        and t.project_id is not null
        and public.is_project_client(t.project_id)
    )
  );
