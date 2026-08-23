-- F206 follow-up: close a live spoofing/phishing vector in
-- public.create_notification() (AS-389).
--
-- The original F206 migration (20260823020000_create_notifications.sql)
-- granted EXECUTE on create_notification() directly to `authenticated`,
-- but only validated that the RECIPIENT (p_user_id) is an active member
-- of p_workspace_id. It never checked that the CALLER (auth.uid()) has
-- any relationship to that workspace, and it accepted p_actor_id as a
-- raw client-supplied parameter instead of pinning it to auth.uid().
-- That means any authenticated user of the app -- even one with zero
-- membership in the target workspace -- could call this RPC directly
-- (e.g. a raw fetch to the Supabase REST RPC endpoint, bypassing the
-- app UI entirely) to inject a fake notification into ANY workspace
-- member's inbox, with an arbitrary spoofed actor_id (impersonating any
-- user) and arbitrary kind/payload content. F206's own handoff flagged
-- this as a known gap "closed by F207's server-side fan-out helper",
-- but since the RPC is reachable directly by `authenticated` today, the
-- gap is exploitable independent of whether F207 exists, so it must be
-- closed at the RPC layer itself -- the same precedent already
-- established by public.write_task_activity_entry() in
-- 20260822230000_create_task_activity.sql.
--
-- Fix, mirroring write_task_activity_entry's p_system pattern exactly:
--
--   - New `p_system boolean default false` parameter for genuinely
--     system-generated notifications (e.g. a future overdue-task
--     reminder cron job per F212, which has no human session at all).
--
--   - Non-system call (p_system = false, the default -- i.e. every
--     call from an authenticated app session today):
--       * requires auth.uid() is not null (raises otherwise);
--       * IGNORES any client-supplied p_actor_id entirely and pins
--         actor_id to auth.uid() -- a caller can never claim to be
--         someone else;
--       * requires the CALLER (not just the recipient) to be an
--         active member of p_workspace_id -- a notification about
--         workspace activity may only be raised by someone who is
--         actually part of that workspace.
--
--   - System call (p_system = true, intended for a future service-role
--     cron job with no user session, e.g. F212): actor_id is forced to
--     null (there is no human actor); the auth.uid()-is-not-null and
--     caller-membership checks are skipped entirely, exactly mirroring
--     write_task_activity_entry's p_system exemption.
--
-- Signature is changing (new trailing parameter with a default), which
-- is compatible with `create or replace function` -- no existing
-- callers exist yet (F206 shipped with no Server Action layer calling
-- this function), so there is nothing to break either way.

-- `create or replace function` cannot be used here: adding a trailing
-- parameter changes the function's signature, so `create or replace`
-- would silently create a NEW overload and leave the old, vulnerable
-- 7-argument version callable in parallel. Drop the old signature
-- explicitly first (this mission's established convention for
-- signature-incompatible changes), then create the fixed one.
drop function if exists public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb);

create function public.create_notification(
  p_user_id uuid,
  p_workspace_id uuid,
  p_kind text,
  p_actor_id uuid default null,
  p_task_id uuid default null,
  p_comment_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_system boolean default false
)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notifications;
  v_actor uuid;
begin
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.status = 'active'
  ) then
    raise exception 'create_notification: recipient % is not an active member of workspace %', p_user_id, p_workspace_id;
  end if;

  if p_system then
    -- System-generated notification (e.g. a future cron job, F212):
    -- no human session exists, so there is no actor and no caller
    -- membership to check.
    v_actor := null;
  else
    if auth.uid() is null then
      raise exception 'create_notification: no authenticated caller';
    end if;

    if not exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
    ) then
      raise exception 'create_notification: caller % is not an active member of workspace %', auth.uid(), p_workspace_id;
    end if;

    -- Never trust a client-supplied actor id: pin it to the caller's
    -- own session, regardless of what p_actor_id was passed.
    v_actor := auth.uid();
  end if;

  insert into public.notifications (
    user_id, workspace_id, kind, actor_id, task_id, comment_id, payload
  )
  values (
    p_user_id, p_workspace_id, p_kind, v_actor, p_task_id, p_comment_id, coalesce(p_payload, '{}'::jsonb)
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb, boolean) from public;
grant execute on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb, boolean) to authenticated, service_role;
