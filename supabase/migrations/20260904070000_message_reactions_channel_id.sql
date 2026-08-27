-- F8 (docs/advanced-chat-plan.md): denormalize `channel_id` onto
-- message_reactions so its realtime subscription can be filtered
-- server-side, mirroring F305's identical fix for comment_reactions'
-- task_id column (20260823080000_fix_comment_reactions_soft_delete_and_
-- scoping.sql) -- same rationale, applied at creation time instead of as
-- a follow-up fix, since F1's original message_reactions table (F1's
-- migration 20260904020000_chat_system.sql) shipped without it and F8 is
-- the first feature to actually add a realtime reactions subscription.
--
-- Without this column, postgres_changes has no way to scope reaction
-- change events to a single channel the way subscribeToChatMessagesRealtime
-- already filters `messages` on `channel_id=eq.<channelId>` -- every
-- authenticated client would otherwise receive every message_reactions
-- INSERT/DELETE in the database (RLS's message_reactions_select_visible
-- policy still gates what postgres_changes actually forwards for INSERT,
-- but DELETE payloads are not RLS-filtered by Supabase Realtime, so an
-- un-react on a message the subscriber can't see would still leak
-- message_id/user_id/emoji to them without a server-side filter column).

alter table message_reactions
  add column if not exists channel_id uuid references channels (id) on delete cascade;

update message_reactions mr
set channel_id = m.channel_id
from messages m
where m.id = mr.message_id
  and mr.channel_id is null;

alter table message_reactions
  alter column channel_id set not null;

create index if not exists message_reactions_channel_id_idx
  on message_reactions (channel_id);

-- channel_id is not part of the composite primary key
-- (message_id, user_id, emoji), so by default Postgres' logical
-- replication would omit it from a DELETE event's OLD row. REPLICA
-- IDENTITY FULL makes the whole OLD row available for DELETE, same fix
-- F305 applied to comment_reactions for the identical reason.
alter table message_reactions replica identity full;

comment on column message_reactions.channel_id is
  'Denormalized from messages.channel_id (F8) so the message_reactions realtime subscription can be filtered server-side with `filter: channel_id=eq.<channelId>`, mirroring comment_reactions.task_id (F305).';

-- SELECT: unchanged predicate, restated to also read naturally as
-- "same channel" now that the column exists (no behavior change).
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

-- INSERT: additionally require the caller-supplied channel_id to match
-- the message's real channel_id, so a client can't forge a
-- message_reactions.channel_id that doesn't correspond to message_id
-- (which would otherwise let a forged channel_id smuggle a reaction
-- event onto a realtime channel the row doesn't really belong to) --
-- mirrors comment_reactions_insert_self's task_id re-check from F305.
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
        and m.channel_id = message_reactions.channel_id
        and cm.user_id = auth.uid()
    )
  );

-- DELETE: unchanged (self-only, no visibility re-check needed, mirrors
-- comment_reactions_delete_self / message_reactions_delete_self).
