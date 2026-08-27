-- F11 (docs/advanced-chat-plan.md): file/image sharing in chat messages.
--
-- New table `message_attachments` rather than widening the existing
-- `attachments` table (which is `task_id`-scoped, not-null): per the plan's
-- explicit recommendation, keeping chat attachments in their own table
-- avoids making `attachments.task_id` nullable and avoids mixing two
-- unrelated RLS/authorization shapes (task-workspace-membership vs.
-- channel-membership) in one table.
--
-- New bucket `chat-attachments` (not `task-attachments`): same
-- recommendation -- a chat attachment's authorization boundary is channel
-- membership, not task/project workspace membership, so it gets its own
-- bucket + policies rather than overloading the task bucket's existing
-- path-parsing INSERT policy (which assumes the first path segment is a
-- *task* id).
--
-- Upload-before-send flow: a message's attachments are uploaded (and this
-- table's row inserted) BEFORE the message itself exists, so this table's
-- `message_id` starts out null and is filled in by `sendMessage`
-- (lib/actions/chat-messages.ts) once the message row is created --
-- mirroring the plan's "storage-first-then-insert" instruction, adapted
-- for chat's "attach while composing" UX (F260-style thumbnail preview
-- before the message is actually sent). `channel_id` is stored directly
-- (not just derived via message_id) precisely because it must be known
-- and enforceable while `message_id` is still null.

create table if not exists message_attachments (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels (id) on delete cascade,
  message_id uuid references messages (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint message_attachments_storage_path_not_empty check (btrim(storage_path) <> ''),
  constraint message_attachments_file_name_not_empty check (btrim(file_name) <> '')
);

comment on table message_attachments is
  'F11: a file/image attached to a chat message. message_id is null between upload and send (the composer uploads eagerly, before the message row exists) -- sendMessage links it by setting message_id once the message is inserted. channel_id is always set (even while message_id is null) so RLS can authorize the pending row against channel membership.';

create index if not exists message_attachments_message_id_idx on message_attachments (message_id) where message_id is not null;
create index if not exists message_attachments_channel_id_idx on message_attachments (channel_id);
create index if not exists message_attachments_uploaded_by_pending_idx on message_attachments (uploaded_by, channel_id) where message_id is null;

alter table message_attachments enable row level security;

-- SELECT: same predicate as messages_select_channel_members -- any active
-- member of the owning channel can see an attachment (pending or linked).
drop policy if exists message_attachments_select_channel_members on message_attachments;
create policy message_attachments_select_channel_members
  on message_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from channel_members cm
      where cm.channel_id = message_attachments.channel_id
        and cm.user_id = auth.uid()
    )
  );

-- INSERT: the uploader must be an active member of the target channel, and
-- uploaded_by/message_id (null at upload time) must match what the app's
-- upload flow actually writes.
drop policy if exists message_attachments_insert_channel_members on message_attachments;
create policy message_attachments_insert_channel_members
  on message_attachments
  for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and message_id is null
    and exists (
      select 1
      from channel_members cm
      where cm.channel_id = message_attachments.channel_id
        and cm.user_id = auth.uid()
    )
  );

-- UPDATE: only the uploader may link their own still-pending attachment to
-- a message (sendMessage's "fill in message_id" step) -- and only to a
-- message in the same channel that they themselves just sent, checked via
-- the `messages` table (sender_id = auth.uid() and channel_id matches).
drop policy if exists message_attachments_update_link_own_pending on message_attachments;
create policy message_attachments_update_link_own_pending
  on message_attachments
  for update
  to authenticated
  using (
    uploaded_by = auth.uid()
    and message_id is null
  )
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1
      from messages m
      where m.id = message_attachments.message_id
        and m.channel_id = message_attachments.channel_id
        and m.sender_id = auth.uid()
    )
  );

-- DELETE: the uploader may delete their own attachment (e.g. removing a
-- pending preview before sending). No admin-override branch, same
-- convention messages_update_sender_only documents for this feature set.
drop policy if exists message_attachments_delete_own on message_attachments;
create policy message_attachments_delete_own
  on message_attachments
  for delete
  to authenticated
  using (uploaded_by = auth.uid());

-- ---------------------------------------------------------------------
-- Private Storage bucket
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

-- Path convention (binding for lib/attachments/upload-chat.ts):
-- `{channel_id}/{uuid-or-filename}` -- first segment is the channel id, so
-- the INSERT policy below can authorize the upload by parsing it out of
-- the object path, exactly like attachments_objects_insert_active_members
-- does for task-attachments (no message_attachments row exists yet to join
-- through at upload time, same reasoning).
create policy chat_attachments_objects_select_channel_members
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from channel_members cm
      where cm.channel_id = (nullif(split_part(storage.objects.name, '/', 1), ''))::uuid
        and cm.user_id = auth.uid()
    )
  );

create policy chat_attachments_objects_insert_channel_members
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from channel_members cm
      where cm.channel_id = (nullif(split_part(storage.objects.name, '/', 1), ''))::uuid
        and cm.user_id = auth.uid()
    )
  );

create policy chat_attachments_objects_delete_channel_members
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from channel_members cm
      where cm.channel_id = (nullif(split_part(storage.objects.name, '/', 1), ''))::uuid
        and cm.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- Realtime: not added to the supabase_realtime publication. Unlike
-- messages/message_reactions, a pending-then-linked attachment doesn't need
-- its own live broadcast for this feature's v1 scope -- the uploader's own
-- client already has the attachment (it uploaded it) and gets the linked
-- result back directly from sendMessage's return value; other channel
-- members see it on their next message-list load/refresh. Documented here
-- as a deliberate scope cut, not an oversight, matching this migration
-- file's own convention of explaining every "no policy/no publication"
-- absence.
-- ---------------------------------------------------------------------
