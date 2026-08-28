-- W3: fix two provably-wrong queries in getWorkspaceChannels
-- (lib/queries/chat.ts).
--
-- Bug 1 (unread counts): the old code fetched EVERY message in every
-- channel the caller belongs to (`.gt("created_at", new Date(0)...)` matches
-- everything since epoch) and filtered in JS. Once the result set exceeds
-- PostgREST's max-rows cap, the response is silently truncated before the
-- JS filter runs, so counts become wrong, not just slow.
--
-- Bug 2 (latest message per channel): the old code ordered messages
-- GLOBALLY by created_at desc and took the top `channelIds.length * 2`
-- rows, assuming that gives ~1 row per channel. That is false: a single
-- busy channel can own all of the most recent rows, starving every other
-- channel of a lastMessageAt and dropping it out of the sidebar's activity
-- sort.
--
-- Both are replaced by a single RPC round-trip using `distinct on`
-- (unavailable via PostgREST) and a straight aggregate, each scoped to the
-- caller's own channel_members rows only -- no caller-supplied channel ids
-- are trusted; the function derives the set of channels from auth.uid()'s
-- own memberships joined against the id list the caller passes in (which
-- must already be a subset of their own memberships -- enforced by the
-- join, not by trusting the input).

create or replace function public.get_chat_channel_summaries(p_channel_ids uuid[])
returns table (
  channel_id uuid,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with my_channels as (
    -- Only channels that are BOTH in the caller-supplied list AND ones the
    -- caller is actually a member of. This is the access boundary: a
    -- caller cannot read another user's unread state by passing arbitrary
    -- channel ids, because last_read_at is always taken from the caller's
    -- OWN channel_members row (auth.uid()), and channels outside their own
    -- membership never appear in this CTE at all.
    select cm.channel_id, cm.last_read_at
    from public.channel_members cm
    where cm.user_id = auth.uid()
      and cm.channel_id = any(p_channel_ids)
  ),
  latest as (
    select distinct on (m.channel_id)
      m.channel_id,
      m.created_at as last_message_at
    from public.messages m
    join my_channels mc on mc.channel_id = m.channel_id
    where m.deleted_at is null
    order by m.channel_id, m.created_at desc
  ),
  unread as (
    select m.channel_id, count(*) as unread_count
    from public.messages m
    join my_channels mc on mc.channel_id = m.channel_id
    where m.deleted_at is null
      and m.created_at > mc.last_read_at
    group by m.channel_id
  )
  select
    mc.channel_id,
    latest.last_message_at,
    coalesce(unread.unread_count, 0) as unread_count
  from my_channels mc
  left join latest on latest.channel_id = mc.channel_id
  left join unread on unread.channel_id = mc.channel_id
$$;

revoke all on function public.get_chat_channel_summaries(uuid[]) from public;
grant execute on function public.get_chat_channel_summaries(uuid[]) to authenticated;
