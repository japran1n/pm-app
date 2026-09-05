-- Client portal phase 2, item A (docs/client-portal-phase-2-plan.md):
-- connect the existing chat system to the client portal. A `client` is a
-- workspace member the moment they're invited, and every existing chat RLS
-- policy in 20260904020000_chat_system.sql was written before that role
-- existed -- this migration closes the paths that role now reaches, and
-- adds the one thing missing: a way to create a project's channel and
-- enroll its current team + client idempotently.
--
-- Findings against a real client session (reasoned from the schema, same
-- category the F006 hardening rounds already found by testing):
--
--   1. `channels_select_members_or_workspace`'s second branch (auto-enroll
--      browse) is gated on `is_active_workspace_member` + (for
--      project-scoped channels) `is_project_visible_to`. Two problems:
--        a. It never excludes `client`, so a client could browse/self-join
--           any WORKSPACE-WIDE channel (project_id is null) in a workspace
--           they belong to -- entirely internal team chat.
--        b. For project-scoped channels, `is_project_visible_to` returns
--           true for ANY active member of a 'workspace'-visibility project,
--           not just its `project_members` -- so a `viewer` (or any other
--           role) who is not on the project could browse into and read a
--           client's own project channel. The plan calls this out
--           explicitly: "a client message landing in a channel a viewer
--           can read is a leak of the client's words, not ours." Decision:
--           project channels are visible only to a project's explicit
--           `project_members` (staff leads/members AND the client, both of
--           whom already require a `project_members` row -- clients via
--           `is_project_visible_to`'s own client branch, staff via
--           whichever route added them), never via workspace-visibility
--           browsing.
--
--   2. `channel_members_insert_self_or_existing_member`'s self-add branch
--      (`user_id = auth.uid()`) has NO visibility check on the target
--      channel at all -- true unconditionally when adding yourself,
--      regardless of whether you can see that channel. Combined with (1),
--      a client (or anyone) who merely guesses/enumerates a channel id
--      could self-insert into `channel_members` for a channel they cannot
--      even SELECT, then read every message in it. Fixed by requiring the
--      self-add row to reference a channel the caller's own session can
--      already see (a bare correlated `exists` against `channels` runs
--      under the caller's role inside a policy body, so it is bound by
--      `channels`' own SELECT RLS -- the fixed version of (1) above).
--
-- Everything else already scopes correctly through `channel_members` once
-- membership itself is trustworthy: `messages_select/insert_channel_members`,
-- `message_reactions_*`, `message_attachments` (F11's own RLS + the
-- `getChatAttachmentSignedUrl` app-layer re-check), full-text search
-- (`searchChannelMessages` fetches `channels` then `messages` through the
-- caller's own session -- both now bounded by the fixes above), and unread
-- counts (`get_chat_channel_summaries` already derives the channel set from
-- the caller's OWN `channel_members` rows, never trusts the input array).
-- Edit/delete were already sender-only at both the RLS
-- (`messages_update_sender_only`) and Server Action layer
-- (lib/actions/chat-messages.ts), so a client editing their own message
-- works and deleting a staff message already fails -- no change needed.
--
-- No new columns are added to any allow-list-guarded table (`projects`,
-- `project_links`) by this migration, so no allow-list guard trigger needs
-- updating.
--
-- One more thing found while proving the "does the member list expose
-- staff" question with a real client session (not in the plan's own list,
-- but blocking it): `channel_members_select_own_or_shared_channel`'s
-- "shared channel" branch is an inline correlated subquery against
-- `channel_members` itself. That subquery is ALSO subject to
-- `channel_members`' own RLS, and Postgres does not re-run the policy a
-- second time against a DIFFERENT target row inside that recursive
-- evaluation the way the migration's own comment assumed -- verified
-- directly (a plain two-person DM, signed in as either member, sees only
-- their own membership row, never the other person's). This predates
-- `client` entirely and affects every role -- it fails toward showing LESS
-- than intended, not a leak, so it was never caught. It is fixed here
-- (not deferred) because it is the exact mechanism the "who else is in
-- this channel" question below depends on; without it there would be
-- nothing to check that question against. Fix: move the "does auth.uid()
-- share this channel" test into a SECURITY DEFINER helper (same shape as
-- `is_active_workspace_member`/`is_project_workspace_member` elsewhere in
-- this schema), which bypasses the recursive RLS entirely instead of
-- tripping over it.

create or replace function public.is_channel_member(target_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from channel_members cm
    where cm.channel_id = target_channel_id
      and cm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_channel_member(uuid) from public;
grant execute on function public.is_channel_member(uuid) to authenticated;

drop policy if exists channel_members_select_own_or_shared_channel on channel_members;
create policy channel_members_select_own_or_shared_channel
  on channel_members
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_channel_member(channel_members.channel_id)
  );

-- ---------------------------------------------------------------------
-- 1. channels: project-scoped browse requires explicit project_members,
--    not just workspace-level visibility; workspace-wide browse excludes
--    clients entirely.
-- ---------------------------------------------------------------------

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
      and (
        (
          -- Workspace-wide channel (no project): active member, but never
          -- a client -- workspace-wide chat is a team space.
          project_id is null
          and public.is_active_workspace_member(workspace_id)
          and not public.is_workspace_client(workspace_id)
        )
        or (
          -- Project channel: explicit project membership only. This is
          -- deliberately narrower than `is_project_visible_to` (which
          -- would also admit any active member of a 'workspace'-visibility
          -- project) so a client's channel is never reachable by a
          -- workspace member who isn't actually on that project.
          project_id is not null
          and exists (
            select 1
            from project_members pm
            where pm.project_id = channels.project_id
              and pm.user_id = auth.uid()
          )
        )
      )
    )
  );

-- ---------------------------------------------------------------------
-- 2. channel_members: self-add must target a channel the caller can
--    already see. This was previously unconditional for `user_id =
--    auth.uid()`, meaning the row's own RLS gated nothing.
-- ---------------------------------------------------------------------

drop policy if exists channel_members_insert_self_or_existing_member on channel_members;
create policy channel_members_insert_self_or_existing_member
  on channel_members
  for insert
  to authenticated
  with check (
    (
      user_id = auth.uid()
      and exists (
        select 1
        from channels c
        where c.id = channel_members.channel_id
      )
    )
    or exists (
      select 1
      from channel_members cm2
      where cm2.channel_id = channel_members.channel_id
        and cm2.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- 3. One project channel per project, created idempotently.
-- ---------------------------------------------------------------------
-- Race-safety for "created lazily": a partial unique index means two
-- concurrent calls to ensure_project_channel_atomic (below) can't both
-- insert a channel row for the same project -- the loser's insert simply
-- no-ops via ON CONFLICT, exactly like create_workspace_with_owner's own
-- uniqueness-guarded upserts elsewhere in this schema.

create unique index if not exists channels_one_channel_per_project_idx
  on channels (project_id)
  where kind = 'channel' and project_id is not null;

-- Creates (if missing) the single project-scoped channel for
-- `p_project_id` and enrolls every current `project_members` row (staff
-- and any client already added to the project) that isn't already a
-- channel member. Idempotent and safe to call on every "portal enabled"
-- toggle and every "client added to project" event -- whichever happens
-- first creates the channel; the other just backfills membership.
--
-- SECURITY DEFINER because it writes `channels`/`channel_members` for
-- users other than the caller (the whole project's team, not just
-- itself) -- the same shape as `create_channel_atomic`. Unlike that
-- function, EXECUTE is granted to `service_role` ONLY, not
-- `authenticated`: this function has no internal caller-identity check
-- (it trusts `p_created_by` and admits every current `project_members`
-- row unconditionally), so it must only ever be reachable through a
-- Server Action's admin client that has already independently verified
-- the caller may manage this project (mirrors sweep_overdue_blocking_
-- deliverables / purge_task's service-role-only grants elsewhere in this
-- schema, rather than create_channel_atomic's broader grant).
create or replace function public.ensure_project_channel_atomic(
  p_project_id uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel_id uuid;
  v_workspace_id uuid;
  v_project_name text;
begin
  select workspace_id, name
    into v_workspace_id, v_project_name
    from projects
    where id = p_project_id
      and deleted_at is null;

  if v_workspace_id is null then
    raise exception 'ensure_project_channel_atomic: project % not found', p_project_id;
  end if;

  insert into channels (workspace_id, project_id, kind, name, created_by)
  values (v_workspace_id, p_project_id, 'channel', coalesce(v_project_name, 'Project'), p_created_by)
  on conflict (project_id) where (kind = 'channel' and project_id is not null)
  do nothing;

  select id into v_channel_id
    from channels
    where project_id = p_project_id
      and kind = 'channel'
    limit 1;

  insert into channel_members (channel_id, user_id)
  select v_channel_id, pm.user_id
    from project_members pm
    where pm.project_id = p_project_id
  on conflict (channel_id, user_id) do nothing;

  return v_channel_id;
end;
$$;

revoke all on function public.ensure_project_channel_atomic(uuid, uuid) from public;
grant execute on function public.ensure_project_channel_atomic(uuid, uuid) to service_role;
