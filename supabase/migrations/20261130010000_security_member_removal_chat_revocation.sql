-- Security fix (audit 2026-09-24), three HIGH findings:
--
-- 1. remove_workspace_member(uuid,uuid,uuid) — added by
--    20261127110000_remove_workspace_member_reassign.sql — is SECURITY
--    DEFINER, was granted EXECUTE to `authenticated`, and does no caller
--    authorization. That regressed 20261025010000 (hole 2), which revoked
--    `authenticated` from the 2-arg version: any signed-in user could call
--    /rest/v1/rpc/remove_workspace_member and evict admins/owners of any
--    workspace and reassign their tasks.
--    Fix: the only caller (lib/actions/workspaces.ts removeMember) checks
--    requireWorkspaceAdmin() and then calls through createAdminClient()
--    (service_role), so EXECUTE is revoked from authenticated/anon/public.
--    Defense in depth: when the function is reached with an end-user JWT
--    anyway, the body requires the caller to be an active owner/admin of
--    the workspace, and an admin may not remove an owner. The sole-owner
--    guard and row locking are unchanged. p_reassign_to must be an active
--    member of the same workspace (and not the removed user) for every
--    caller. The unused 2-arg overload is dropped (no app, SQL or function
--    caller — grep + pg_proc.prosrc).
--
-- 2. Removal did not revoke chat. channel_members / project_members rows
--    survived, and chat RLS checked only channel_members, so removed users
--    kept reading and posting in every channel and DM (incl. Realtime
--    postgres_changes, which evaluates the SELECT policies below).
--    Fix: (a) remove_workspace_member deletes the removed user's
--    channel_members rows for channels of that workspace and their
--    project_members rows for projects of that workspace, in the same
--    transaction (channels and messages are kept — DMs just lose that
--    member); (b) is_channel_member() now also requires active membership
--    of the channel's workspace, and every chat policy goes through it (or
--    is_active_workspace_member), so a stale row no longer grants anything;
--    (c) channel_members INSERT no longer lets any user add themselves to
--    ANY existing channel (it previously only checked the channel existed —
--    including DMs and channels of other workspaces), which would have let
--    a removed user re-enrol; it now mirrors lib/actions/chat-channels.ts
--    addChannelMember's eligibility rules; (d) one-off cleanup of existing
--    stale rows (0 channel_members / 0 project_members on 2026-09-24).
--
-- 3. chat-attachments storage DELETE let any channel member (portal
--    clients included) delete ANY chat file. The app never deletes another
--    user's chat file (only deletePendingChatAttachment, uploader-only, via
--    service_role), so DELETE is now uploader-only: storage owner or the
--    message_attachments row's uploaded_by, plus current channel access.
--
-- Idempotent; every function pins search_path.

-- ---------------------------------------------------------------------------
-- 1. remove_workspace_member
-- ---------------------------------------------------------------------------

drop function if exists public.remove_workspace_member(uuid, uuid);

create or replace function public.remove_workspace_member(
  p_membership_id uuid,
  p_workspace_id  uuid,
  p_reassign_to   uuid default null
)
returns table (
  deleted boolean,
  reason  text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id          uuid;
  v_role             text;
  v_status           text;
  v_remaining_owners int;
  v_caller           uuid := auth.uid();
  v_claim_role       text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_caller_role      text;
begin
  -- Caller authorization for end-user sessions. service_role (the app's
  -- admin client, after requireWorkspaceAdmin) and direct postgres
  -- sessions (no JWT) skip this; EXECUTE is not granted to
  -- authenticated/anon, so this is defense in depth.
  if v_claim_role <> 'service_role'
     and (v_caller is not null or v_claim_role in ('anon', 'authenticated')) then
    if v_caller is null then
      raise exception 'remove_workspace_member: not authorized'
        using errcode = '42501';
    end if;

    select wm.role
      into v_caller_role
      from public.workspace_members wm
     where wm.workspace_id = p_workspace_id
       and wm.user_id      = v_caller
       and wm.status       = 'active';

    if v_caller_role is null or v_caller_role not in ('owner', 'admin') then
      raise exception 'remove_workspace_member: caller is not an active owner/admin of this workspace'
        using errcode = '42501';
    end if;
  end if;

  -- Lock the target row first so concurrent calls targeting the *same* row
  -- serialize on it too.
  select wm.user_id, wm.role, wm.status
    into v_user_id, v_role, v_status
    from public.workspace_members wm
   where wm.id           = p_membership_id
     and wm.workspace_id = p_workspace_id
   for update;

  if not found then
    return query select false, 'not_found';
    return;
  end if;

  if v_status <> 'active' then
    return query select false, 'not_active';
    return;
  end if;

  if v_caller_role = 'admin' and v_role = 'owner' then
    raise exception 'remove_workspace_member: an admin cannot remove an owner'
      using errcode = '42501';
  end if;

  if p_reassign_to is not null
     and (
       p_reassign_to is not distinct from v_user_id
       or not exists (
         select 1
           from public.workspace_members rw
          where rw.workspace_id = p_workspace_id
            and rw.user_id      = p_reassign_to
            and rw.status       = 'active'
       )
     ) then
    return query select false, 'invalid_reassignee';
    return;
  end if;

  if v_role = 'owner' then
    -- Lock all active-owner rows for this workspace so a concurrent call
    -- cannot read a stale count.
    perform 1
      from public.workspace_members wm
     where wm.workspace_id = p_workspace_id
       and wm.role         = 'owner'
       and wm.status       = 'active'
       for update;

    select count(*)
      into v_remaining_owners
      from public.workspace_members wm
     where wm.workspace_id = p_workspace_id
       and wm.role         = 'owner'
       and wm.status       = 'active';

    if v_remaining_owners <= 1 then
      return query select false, 'sole_owner';
      return;
    end if;
  end if;

  -- ── Assignment cleanup (unchanged from 20261127110000) ─────────────────
  if v_user_id is not null then

    if p_reassign_to is not null then
      insert into public.task_assignees (task_id, user_id, assigned_by, created_at)
      select ta.task_id, p_reassign_to, null, now()
        from public.task_assignees    ta
        join public.tasks             t  on t.id = ta.task_id
        join public.projects          p  on p.id = t.project_id
        join public.workspace_members rw
          on rw.workspace_id = p.workspace_id
         and rw.user_id      = p_reassign_to
         and rw.status       = 'active'
       where ta.user_id     = v_user_id
         and p.workspace_id = p_workspace_id
         and (
           rw.role in ('owner', 'admin')
           or (
             rw.role not in ('guest', 'client')
             and p.visibility = 'workspace'
           )
           or exists (
             select 1
               from public.project_members pm
              where pm.project_id = p.id
                and pm.user_id    = p_reassign_to
           )
         )
      on conflict (task_id, user_id) do nothing;

      delete from public.task_assignees ta
       using public.tasks    t,
             public.projects p
       where ta.user_id     = v_user_id
         and ta.task_id     = t.id
         and t.project_id   = p.id
         and p.workspace_id = p_workspace_id;

      update public.tasks t
         set assignee_id = case
               when (
                 exists (
                   select 1
                     from public.workspace_members rw2
                     join public.projects p2 on p2.id = t.project_id
                    where rw2.workspace_id = p2.workspace_id
                      and rw2.user_id      = p_reassign_to
                      and rw2.status       = 'active'
                      and (
                        rw2.role in ('owner', 'admin')
                        or (
                          rw2.role not in ('guest', 'client')
                          and p2.visibility = 'workspace'
                        )
                        or exists (
                          select 1
                            from public.project_members pm2
                           where pm2.project_id = p2.id
                             and pm2.user_id    = p_reassign_to
                        )
                      )
                 )
               ) then p_reassign_to
               else null
             end
        from public.projects p3
       where t.assignee_id   = v_user_id
         and t.project_id    = p3.id
         and p3.workspace_id = p_workspace_id;

    else
      delete from public.task_assignees ta
       using public.tasks    t,
             public.projects p
       where ta.user_id     = v_user_id
         and ta.task_id     = t.id
         and t.project_id   = p.id
         and p.workspace_id = p_workspace_id;

      update public.tasks t
         set assignee_id = null
        from public.projects p
       where t.assignee_id  = v_user_id
         and t.project_id   = p.id
         and p.workspace_id = p_workspace_id;
    end if;

    -- ── Access revocation (new) ────────────────────────────────────────
    -- Chat: drop the user's membership of every channel (incl. DMs) in
    -- this workspace. Channels and messages are kept.
    delete from public.channel_members cm
     using public.channels c
     where cm.user_id      = v_user_id
       and cm.channel_id   = c.id
       and c.workspace_id  = p_workspace_id;

    -- Projects: explicit project membership in this workspace.
    delete from public.project_members pm
     using public.projects p
     where pm.user_id      = v_user_id
       and pm.project_id   = p.id
       and p.workspace_id  = p_workspace_id;

  end if;

  delete from public.workspace_members wm
   where wm.id           = p_membership_id
     and wm.workspace_id = p_workspace_id
     and wm.status       = 'active';

  return query select true, null::text;
end;
$$;

revoke all on function public.remove_workspace_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Chat predicates
-- ---------------------------------------------------------------------------

-- A channel_members row only counts while the caller is still an active
-- member of the channel's workspace.
create or replace function public.is_channel_member(target_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channel_members   cm
      join public.channels          c  on c.id = cm.channel_id
      join public.workspace_members wm on wm.workspace_id = c.workspace_id
     where cm.channel_id = target_channel_id
       and cm.user_id    = auth.uid()
       and wm.user_id    = auth.uid()
       and wm.status     = 'active'
  );
$$;

revoke all on function public.is_channel_member(uuid) from public, anon;
grant execute on function public.is_channel_member(uuid) to authenticated, service_role;

-- Whether p_user_id may hold a channel_members row for a (non-DM) channel,
-- mirroring lib/actions/chat-channels.ts addChannelMember: active member of
-- the channel's workspace; workspace-wide channel -> not a client; project
-- channel -> explicit project_members row. DMs are never joinable via RLS
-- (the app creates them through find_or_create_dm_channel_atomic).
create or replace function public.is_channel_member_eligible(
  target_channel_id uuid,
  target_user_id    uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channels          c
      join public.workspace_members wm on wm.workspace_id = c.workspace_id
     where c.id       = target_channel_id
       and c.kind     = 'channel'
       and wm.user_id = target_user_id
       and wm.status  = 'active'
       and (
         (c.project_id is null and wm.role <> 'client')
         or (
           c.project_id is not null
           and exists (
             select 1
               from public.project_members pm
              where pm.project_id = c.project_id
                and pm.user_id    = target_user_id
           )
         )
       )
  );
$$;

revoke all on function public.is_channel_member_eligible(uuid, uuid) from public, anon;
grant execute on function public.is_channel_member_eligible(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Chat RLS policies (same names, re-created)
-- ---------------------------------------------------------------------------

-- channels
drop policy if exists channels_select_members_or_workspace on public.channels;
create policy channels_select_members_or_workspace on public.channels
  for select to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      public.is_channel_member(id)
      or (
        kind = 'channel'
        and (
          (project_id is null and not public.is_workspace_client(workspace_id))
          or (
            project_id is not null
            and exists (
              select 1
                from public.project_members pm
               where pm.project_id = channels.project_id
                 and pm.user_id    = (select auth.uid())
            )
          )
        )
      )
    )
  );

-- channel_members
drop policy if exists channel_members_select_own on public.channel_members;
create policy channel_members_select_own on public.channel_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_channel_member(channel_id)
  );

drop policy if exists channel_members_select_own_or_shared_channel on public.channel_members;
create policy channel_members_select_own_or_shared_channel on public.channel_members
  for select to authenticated
  using (public.is_channel_member(channel_id));

drop policy if exists channel_members_update_own on public.channel_members;
create policy channel_members_update_own on public.channel_members
  for update to authenticated
  using (user_id = (select auth.uid()) and public.is_channel_member(channel_id))
  with check (user_id = (select auth.uid()) and public.is_channel_member(channel_id));

drop policy if exists channel_members_insert_self_or_existing_member on public.channel_members;
create policy channel_members_insert_self_or_existing_member on public.channel_members
  for insert to authenticated
  with check (
    public.is_channel_member_eligible(channel_id, user_id)
    and (
      user_id = (select auth.uid())
      or public.is_channel_member(channel_id)
    )
  );

-- Leaving is always allowed; removing someone else needs live access.
drop policy if exists channel_members_delete_self_or_existing_member on public.channel_members;
create policy channel_members_delete_self_or_existing_member on public.channel_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_channel_member(channel_id)
  );

-- messages
drop policy if exists messages_select_channel_members on public.messages;
create policy messages_select_channel_members on public.messages
  for select to authenticated
  using (public.is_channel_member(channel_id));

drop policy if exists messages_insert_channel_members on public.messages;
create policy messages_insert_channel_members on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_channel_member(channel_id)
  );

drop policy if exists messages_update_sender_only on public.messages;
create policy messages_update_sender_only on public.messages
  for update to authenticated
  using (sender_id = (select auth.uid()) and public.is_channel_member(channel_id))
  with check (sender_id = (select auth.uid()) and public.is_channel_member(channel_id));

-- message_attachments
drop policy if exists message_attachments_select_channel_members on public.message_attachments;
create policy message_attachments_select_channel_members on public.message_attachments
  for select to authenticated
  using (public.is_channel_member(channel_id));

drop policy if exists message_attachments_insert_channel_members on public.message_attachments;
create policy message_attachments_insert_channel_members on public.message_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and message_id is null
    and public.is_channel_member(channel_id)
  );

drop policy if exists message_attachments_update_link_own_pending on public.message_attachments;
create policy message_attachments_update_link_own_pending on public.message_attachments
  for update to authenticated
  using (
    uploaded_by = (select auth.uid())
    and message_id is null
    and public.is_channel_member(channel_id)
  )
  with check (
    uploaded_by = (select auth.uid())
    and public.is_channel_member(channel_id)
    and exists (
      select 1
        from public.messages m
       where m.id         = message_attachments.message_id
         and m.channel_id = message_attachments.channel_id
         and m.sender_id  = (select auth.uid())
    )
  );

drop policy if exists message_attachments_delete_own on public.message_attachments;
create policy message_attachments_delete_own on public.message_attachments
  for delete to authenticated
  using (
    uploaded_by = (select auth.uid())
    and public.is_channel_member(channel_id)
  );

-- message_reactions
drop policy if exists message_reactions_select_visible on public.message_reactions;
create policy message_reactions_select_visible on public.message_reactions
  for select to authenticated
  using (public.is_channel_member(channel_id));

drop policy if exists message_reactions_insert_self on public.message_reactions;
create policy message_reactions_insert_self on public.message_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_channel_member(channel_id)
    and exists (
      select 1
        from public.messages m
       where m.id         = message_reactions.message_id
         and m.channel_id = message_reactions.channel_id
    )
  );

drop policy if exists message_reactions_delete_self on public.message_reactions;
create policy message_reactions_delete_self on public.message_reactions
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_channel_member(channel_id)
  );

-- storage.objects, bucket chat-attachments (path: {channel_id}/{file})
drop policy if exists chat_attachments_objects_select_channel_members on storage.objects;
create policy chat_attachments_objects_select_channel_members on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_channel_member((nullif(split_part(name, '/', 1), ''))::uuid)
  );

drop policy if exists chat_attachments_objects_insert_channel_members on storage.objects;
create policy chat_attachments_objects_insert_channel_members on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and public.is_channel_member((nullif(split_part(name, '/', 1), ''))::uuid)
  );

drop policy if exists chat_attachments_objects_delete_channel_members on storage.objects;
drop policy if exists chat_attachments_objects_delete_uploader on storage.objects;
create policy chat_attachments_objects_delete_uploader on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_channel_member((nullif(split_part(name, '/', 1), ''))::uuid)
    and (
      owner_id = (select auth.uid())::text
      or exists (
        select 1
          from public.message_attachments ma
         where ma.storage_path = objects.name
           and ma.uploaded_by  = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Chat summary RPCs (callable by authenticated): same live-access rule
-- ---------------------------------------------------------------------------

create or replace function public.get_chat_channel_summaries(p_channel_ids uuid[])
returns table (channel_id uuid, last_message_at timestamptz, unread_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with my_channels as (
    -- Channels in the caller-supplied list that the caller has LIVE access
    -- to (own channel_members row + active workspace membership).
    select cm.channel_id, cm.last_read_at
    from public.channel_members cm
    where cm.user_id = auth.uid()
      and cm.channel_id = any(p_channel_ids)
      and public.is_channel_member(cm.channel_id)
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

create or replace function public.get_workspace_chat_unread_total(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(unread.unread_count), 0)::integer
  from (
    select count(*) as unread_count
    from public.messages m
    join public.channel_members cm
      on cm.channel_id = m.channel_id
     and cm.user_id = auth.uid()
    join public.channels c
      on c.id = m.channel_id
     and c.workspace_id = p_workspace_id
    where m.deleted_at is null
      and m.created_at > cm.last_read_at
      and public.is_active_workspace_member(p_workspace_id)
    group by m.channel_id
  ) as unread
$$;

-- ---------------------------------------------------------------------------
-- 5. One-off cleanup of stale rows (users with no active or pending
--    membership left in the workspace). 0 + 0 rows on 2026-09-24.
-- ---------------------------------------------------------------------------

delete from public.channel_members cm
 using public.channels c
 where cm.channel_id = c.id
   and not exists (
     select 1
       from public.workspace_members wm
      where wm.workspace_id = c.workspace_id
        and wm.user_id      = cm.user_id
        and wm.status in ('active', 'invited')
   );

delete from public.project_members pm
 using public.projects p
 where pm.project_id = p.id
   and not exists (
     select 1
       from public.workspace_members wm
      where wm.workspace_id = p.workspace_id
        and wm.user_id      = pm.user_id
        and wm.status in ('active', 'invited')
   );
