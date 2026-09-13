-- F012 (perf/latency): additive-only migration. Adds
-- get_workspace_chat_unread_total(p_workspace_id uuid), a single-round-trip
-- RPC returning the caller's total unread message count across every
-- channel they belong to in the given workspace.
--
-- Nothing in the app calls this function yet -- it is added ahead of the
-- call site so the call site's own feature can land as a smaller, focused
-- change. Safe to apply on its own.
--
-- Modeled on public.get_chat_channel_summaries (see
-- 20260905040000_chat_channel_summary_rpcs.sql): access boundary is
-- `channel_members.user_id = auth.uid()` -- the caller can never see
-- another user's unread state because last_read_at always comes from
-- their OWN channel_members row. p_workspace_id only narrows which of the
-- caller's own channels are considered; it does not grant any additional
-- visibility.
--
-- search_path is pinned to `public` (not `''`) to match the existing
-- convention documented in 20261120020000_function_search_path_hardening.sql:
-- this function's body uses unqualified table names, so pinning to
-- `public` removes the mutability risk while preserving name resolution.

create or replace function public.get_workspace_chat_unread_total(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(unread.unread_count), 0)::integer
  from (
    select count(*) as unread_count
    from messages m
    join channel_members cm
      on cm.channel_id = m.channel_id
     and cm.user_id = auth.uid()
    join channels c
      on c.id = m.channel_id
     and c.workspace_id = p_workspace_id
    where m.deleted_at is null
      and m.created_at > cm.last_read_at
    group by m.channel_id
  ) as unread
$$;

revoke all on function public.get_workspace_chat_unread_total(uuid) from public;
grant execute on function public.get_workspace_chat_unread_total(uuid) to authenticated;
