-- F1 (docs/advanced-chat-plan.md): DB schema + RLS foundation for the
-- advanced chat system (workspace channels, DMs, threaded replies,
-- reactions). Everything downstream (F2-F13) builds on this migration;
-- no UI or Server Action code ships here.
--
-- Shape mirrors two existing patterns per the plan's explicit instruction
-- not to invent a new style:
--   - comment_reactions (20260823010000_create_comment_reactions.sql) for
--     message_reactions: composite PK (message_id, user_id, emoji), same
--     emoji allow-list, same realtime-publication guarded block.
--   - notifications (20260823020000_create_notifications.sql) for the
--     general "workspace_id-scoped, RLS-first table with a CHECK-enforced
--     enum-like column" shape, applied here to `channels.kind`.
--
-- Retention: chat is kept forever, same as comments/activity_log (open
-- decision #3 in the plan, "preporuka" branch) -- no expires_at column.
--
-- Channel scope (open decision #1 in the plan, "preporuka" branch): one
-- workspace-wide channel per workspace (auto-enrolled in F2) plus
-- optional per-project channels and DMs, not a fully custom taxonomy.
-- `channels.project_id` is nullable: null means workspace-wide/DM, set
-- means project-scoped.
--
-- Message format (open decision #2 in the plan, "preporuco" branch):
-- plain text for v1, stored as `body_json` (jsonb) to keep the column
-- shape stable if a rich-text editor is introduced later (F13), mirroring
-- how comments.body_json already stores plain-text-wrapped-in-JSON before
-- a Tiptap editor existed for it.

-- ---------------------------------------------------------------------
-- channels
-- ---------------------------------------------------------------------
create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id uuid references projects (id) on delete cascade,
  kind text not null check (kind in ('channel', 'dm')),
  name text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint channels_channel_kind_requires_name check (
    kind <> 'channel' or (name is not null and btrim(name) <> '')
  )
);

comment on table channels is
  'F1: a chat channel (workspace-wide or project-scoped, kind=''channel'') or a direct message thread (kind=''dm'', no name). project_id null means workspace-wide/DM.';

create index if not exists channels_workspace_id_idx on channels (workspace_id);
create index if not exists channels_project_id_idx on channels (project_id) where project_id is not null;

-- ---------------------------------------------------------------------
-- channel_members
-- ---------------------------------------------------------------------
create table if not exists channel_members (
  channel_id uuid not null references channels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

comment on table channel_members is
  'F1: membership + read-cursor (last_read_at, used by F5 unread counts) for a channel. Presence of a row is what "member" means everywhere in this feature set -- RLS on channels/messages/reactions all key off this table.';

create index if not exists channel_members_user_id_idx on channel_members (user_id);

-- ---------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels (id) on delete cascade,
  sender_id uuid not null references auth.users (id),
  body_json jsonb not null,
  parent_message_id uuid references messages (id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table messages is
  'F1: a chat message. parent_message_id (set, on delete set null) marks a threaded reply, consumed by F10 -- messages with parent_message_id null are top-level in a channel''s main list. deleted_at is a soft delete (mirrors comments.deleted_at); deleted messages remain in place so open clients can render a "Message deleted" placeholder instead of the row vanishing (F3 acceptance).';

create index if not exists messages_channel_created_idx on messages (channel_id, created_at);
create index if not exists messages_parent_message_id_idx on messages (parent_message_id) where parent_message_id is not null;
create index if not exists messages_sender_id_idx on messages (sender_id);

-- ---------------------------------------------------------------------
-- message_reactions (copy of comment_reactions, message_id instead of
-- comment_id, same emoji allow-list per the plan's explicit "literal
-- copy-paste" instruction for F8's future consumption)
-- ---------------------------------------------------------------------
create table if not exists message_reactions (
  message_id uuid not null references messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint message_reactions_emoji_allowlist check (
    emoji in ('👍', '❤️', '😄', '🎉', '👀', '🚀')
  )
);

comment on table message_reactions is
  'F1: emoji reactions on chat messages, structurally identical to comment_reactions (composite PK enforces one reaction per (message, user, emoji)). Populated by a future F8 Server Action; schema/RLS ship now so F1 is a complete foundation.';

create index if not exists message_reactions_user_id_idx on message_reactions (user_id);

-- ---------------------------------------------------------------------
-- RLS: channels
-- ---------------------------------------------------------------------
alter table channels enable row level security;

-- SELECT: visible if the caller is already a member (covers DMs and any
-- channel they were explicitly added to), OR -- for the auto-enroll
-- workspace-wide channel case (F2) -- if it's a plain 'channel' (not a
-- DM) and the caller is an active workspace member. Project-scoped
-- channels additionally require is_project_visible_to so a private
-- project's channel doesn't leak to workspace-only members, mirroring
-- 20260821140526_project_visibility_rls_sweep.sql's approach for tasks.
drop policy if exists channels_select_members_or_workspace on channels;
create policy channels_select_members_or_workspace
  on channels
  for select
  to authenticated
  using (
    exists (
      select 1
      from channel_members cm
      where cm.channel_id = channels.id
        and cm.user_id = auth.uid()
    )
    or (
      kind = 'channel'
      and public.is_active_workspace_member(workspace_id)
      and (
        project_id is null
        or public.is_project_visible_to(project_id)
      )
    )
  );

-- INSERT: any active workspace member may create a channel; if scoped to
-- a project, the project must be visible to them. created_by must be the
-- caller (defense in depth -- Server Actions in F2 also enforce this).
drop policy if exists channels_insert_active_members on channels;
create policy channels_insert_active_members
  on channels
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

-- ---------------------------------------------------------------------
-- RLS: channel_members
-- ---------------------------------------------------------------------
alter table channel_members enable row level security;

-- SELECT: a user sees their own membership row, plus every membership
-- row for any channel they themselves belong to (so the "who's in this
-- channel" member list in F4/F7 works).
drop policy if exists channel_members_select_own_or_shared_channel on channel_members;
create policy channel_members_select_own_or_shared_channel
  on channel_members
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from channel_members cm2
      where cm2.channel_id = channel_members.channel_id
        and cm2.user_id = auth.uid()
    )
  );

-- INSERT: a user may add themselves to a channel they can already see
-- (covers the auto-enroll workspace-wide case and joining a visible
-- project channel), or an existing member of a channel may add someone
-- else to it (covers F2's addChannelMember for private/DM channels,
-- where the channel isn't visible to non-members via channels_select).
drop policy if exists channel_members_insert_self_or_existing_member on channel_members;
create policy channel_members_insert_self_or_existing_member
  on channel_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or exists (
      select 1
      from channel_members cm2
      where cm2.channel_id = channel_members.channel_id
        and cm2.user_id = auth.uid()
    )
  );

-- DELETE: a member may remove their own membership (leave a channel), or
-- an existing member may remove another member (F2's removeChannelMember).
drop policy if exists channel_members_delete_self_or_existing_member on channel_members;
create policy channel_members_delete_self_or_existing_member
  on channel_members
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from channel_members cm2
      where cm2.channel_id = channel_members.channel_id
        and cm2.user_id = auth.uid()
    )
  );

-- UPDATE: a member may only update their own row (last_read_at, for F5's
-- markChannelRead).
drop policy if exists channel_members_update_own on channel_members;
create policy channel_members_update_own
  on channel_members
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- RLS: messages
-- ---------------------------------------------------------------------
alter table messages enable row level security;

-- SELECT: requires an active channel_members row for this channel.
drop policy if exists messages_select_channel_members on messages;
create policy messages_select_channel_members
  on messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from channel_members cm
      where cm.channel_id = messages.channel_id
        and cm.user_id = auth.uid()
    )
  );

-- INSERT: requires channel membership AND sender_id = auth.uid() (per
-- the plan's spec, both conditions explicitly required).
drop policy if exists messages_insert_channel_members on messages;
create policy messages_insert_channel_members
  on messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1
      from channel_members cm
      where cm.channel_id = messages.channel_id
        and cm.user_id = auth.uid()
    )
  );

-- UPDATE: only the sender may update their own message (edit/soft
-- delete, F3/F9). No admin-override branch: unlike comments, the plan
-- does not call for admin moderation of chat messages in this feature,
-- so a plain sender-only predicate is sufficient (no OLD/NEW trigger
-- needed the way comments_edit_author_only required one, since there is
-- no second permissive policy here that would otherwise widen access).
drop policy if exists messages_update_sender_only on messages;
create policy messages_update_sender_only
  on messages
  for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- ---------------------------------------------------------------------
-- RLS: message_reactions (mirrors comment_reactions_* policies)
-- ---------------------------------------------------------------------
alter table message_reactions enable row level security;

drop policy if exists message_reactions_select_visible on message_reactions;
create policy message_reactions_select_visible
  on message_reactions
  for select
  to authenticated
  using (
    exists (
      select 1
      from messages m
      join channel_members cm on cm.channel_id = m.channel_id
      where m.id = message_reactions.message_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists message_reactions_insert_self on message_reactions;
create policy message_reactions_insert_self
  on message_reactions
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from messages m
      join channel_members cm on cm.channel_id = m.channel_id
      where m.id = message_reactions.message_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists message_reactions_delete_self on message_reactions;
create policy message_reactions_delete_self
  on message_reactions
  for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Realtime: add all four tables to the same supabase_realtime
-- publication comments/notifications already use, so F3/F5/F6-F8's
-- postgres_changes subscriptions have the plumbing in place. RLS above
-- still governs which authenticated clients actually receive events.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'channels'
  ) then
    alter publication supabase_realtime add table public.channels;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'channel_members'
  ) then
    alter publication supabase_realtime add table public.channel_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end
$$;
