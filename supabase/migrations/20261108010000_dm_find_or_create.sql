-- Team 1:1 direct messages: find-or-create a DM channel between two
-- workspace members instead of letting the existing `createChannel`
-- Server Action (lib/actions/chat-channels.ts) mint a fresh `kind='dm'`
-- channel row every time someone clicks "message" on the same person.
--
-- `channels.kind` already includes 'dm' (20260904020000_chat_system.sql) --
-- what's missing is a uniqueness guarantee for "this pair of users already
-- has a DM in this workspace" and an atomic find-or-create RPC that uses
-- it, mirroring `create_channel_atomic` / `ensure_project_channel_atomic`'s
-- existing "single SECURITY DEFINER function, one implicit transaction"
-- shape for the same reason: two near-simultaneous "message this person"
-- clicks (or a page double-submit) must not race into two separate DM
-- channels for the same pair.
--
-- Two new nullable columns (`dm_user_low`/`dm_user_high`, always the pair's
-- user ids in a stable `least`/`greatest` order) back a partial unique
-- index scoped to `kind = 'dm'` -- a plain `channel_members` join can't
-- express "these exact two users, no more no less" as a database
-- constraint, so the pair is denormalized onto `channels` itself
-- specifically to make that constraint possible, the same reasoning
-- `channels_one_channel_per_project_idx` already established for "one
-- channel per project".

alter table channels
  add column if not exists dm_user_low uuid references auth.users (id),
  add column if not exists dm_user_high uuid references auth.users (id);

comment on column channels.dm_user_low is
  'DM pairing (kind=''dm'' only): the lower of the two member ids (least(a,b)). Null for kind=''channel''.';
comment on column channels.dm_user_high is
  'DM pairing (kind=''dm'' only): the higher of the two member ids (greatest(a,b)). Null for kind=''channel''.';

alter table channels drop constraint if exists channels_dm_pair_requires_users;
alter table channels
  add constraint channels_dm_pair_requires_users check (
    kind <> 'dm'
    or (dm_user_low is not null and dm_user_high is not null and dm_user_low <> dm_user_high)
  );

create unique index if not exists channels_dm_unique_pair_idx
  on channels (workspace_id, dm_user_low, dm_user_high)
  where kind = 'dm';

-- Finds the existing DM channel for (p_user_a, p_user_b) in p_workspace_id,
-- or creates one (plus both members' channel_members rows) if none exists
-- yet. SECURITY DEFINER + service_role-only grant, same rationale as
-- `ensure_project_channel_atomic`: this function trusts its arguments and
-- writes a channel_members row for a user (p_user_b) other than the
-- caller, so it must only be reachable through a Server Action that has
-- already independently verified both users are active members of
-- p_workspace_id (lib/actions/chat-channels.ts's findOrCreateDirectMessage).
create or replace function public.find_or_create_dm_channel_atomic(
  p_workspace_id uuid,
  p_user_a uuid,
  p_user_b uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_low uuid := least(p_user_a, p_user_b);
  v_high uuid := greatest(p_user_a, p_user_b);
  v_channel_id uuid;
begin
  if p_user_a = p_user_b then
    raise exception 'find_or_create_dm_channel_atomic: cannot DM yourself';
  end if;

  select id into v_channel_id
    from channels
    where workspace_id = p_workspace_id
      and kind = 'dm'
      and dm_user_low = v_low
      and dm_user_high = v_high;

  if v_channel_id is not null then
    return v_channel_id;
  end if;

  insert into channels (workspace_id, kind, created_by, dm_user_low, dm_user_high)
  values (p_workspace_id, 'dm', p_created_by, v_low, v_high)
  on conflict (workspace_id, dm_user_low, dm_user_high) where (kind = 'dm')
  do nothing
  returning id into v_channel_id;

  if v_channel_id is null then
    -- Lost the insert race to a concurrent caller; the winner's row is now
    -- visible to this transaction.
    select id into v_channel_id
      from channels
      where workspace_id = p_workspace_id
        and kind = 'dm'
        and dm_user_low = v_low
        and dm_user_high = v_high;
  end if;

  insert into channel_members (channel_id, user_id)
  values (v_channel_id, p_user_a), (v_channel_id, p_user_b)
  on conflict (channel_id, user_id) do nothing;

  return v_channel_id;
end;
$$;

revoke all on function public.find_or_create_dm_channel_atomic(uuid, uuid, uuid, uuid) from public;
grant execute on function public.find_or_create_dm_channel_atomic(uuid, uuid, uuid, uuid) to service_role;
