-- F309 follow-up (M15 second scrutiny pass, blocker finding #2, AS-389):
-- close a live spoofing bypass in public.create_notification() that
-- survived the earlier 20260823030000 fix.
--
-- That earlier fix added a p_system boolean intended for genuine
-- service-role/cron callers with no user session (e.g. F212's overdue
-- sweep). But the branch was written as `if p_system then ... else
-- <auth.uid()-is-not-null check + caller-membership check> end if` --
-- UNCONDITIONAL on p_system alone, with no check that the caller
-- actually lacks a session. Since create_notification() is granted to
-- `authenticated`, any signed-in client could call it directly with
-- p_system => true and skip BOTH the auth.uid()-is-not-null check AND
-- the caller-workspace-membership check entirely, injecting a
-- "System"-attributed (actor_id = null) notification into any workspace
-- member's inbox with an arbitrary kind/payload/task/comment reference --
-- exactly the same class of bug already fixed today in
-- public.write_task_activity_entry() (20260823060000). That migration's
-- fix is the template applied here verbatim:
--
--   if p_system then                     -->  if p_system and auth.uid() is null then
--
-- so the system exemption from the auth.uid()/membership checks now only
-- applies when the caller genuinely has NO session at all (a real
-- service-role/cron caller). An `authenticated`-role client call always
-- carries a real auth.uid(), so passing p_system => true can no longer
-- bypass anything for such a caller -- it falls through to the normal
-- branch (auth.uid() is not null check, caller-workspace-membership
-- check, actor pinned to auth.uid()), identical to a non-system call.
--
-- Confirmed no legitimate caller breaks:
--   - F212's overdue-sweep migration (20260823050000_overdue_notification_
--     sweep.sql) calls create_notification(..., p_system => true) from
--     inside a SECURITY DEFINER function invoked by pg_cron running as
--     postgres -- there is no user JWT/session in that execution context
--     at all, so auth.uid() is already null there today. This fix does
--     not change that call's behavior in any way: `p_system and
--     auth.uid() is null` still evaluates to true for it.
--   - The only other p_system => true call sites are this migration's own
--     new test and tests/integration/rls-notifications.test.ts's seed
--     calls, which use the admin (service-role) client -- service_role
--     requests also carry no auth.uid() session, so those are unaffected
--     too.
--   - No other system-style caller exists in the codebase (grepped for
--     "p_system" across .ts/.tsx/.sql, excluding node_modules).
--
-- Signature is unchanged (same parameters, same defaults) -- only the
-- internal branching logic changes -- so `create or replace function` is
-- sufficient; no `drop function` needed (contrast with the original
-- 20260823030000 fix, which added a new trailing parameter).
create or replace function public.create_notification(
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

  -- A system-generated notification is only exempt from the caller
  -- auth/membership checks when the caller genuinely has no user session
  -- at all (a real service-role/cron/backend caller, e.g. F212's overdue
  -- sweep). A caller claiming p_system => true while holding a real
  -- auth.uid() (any `authenticated`-role client session) is NOT exempt --
  -- it falls through to the same checks as a normal, human-attributed
  -- call, so passing p_system => true can no longer be used to skip the
  -- caller-membership check or forge a "System" notification.
  if p_system and auth.uid() is null then
    -- System-generated notification (e.g. F212's overdue sweep): no
    -- human session exists, so there is no actor and no caller
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

-- Grants are unchanged from the original migration (same signature), but
-- re-asserted here for clarity/defense-in-depth after the replace.
revoke all on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb, boolean) from public;
grant execute on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb, boolean) to authenticated, service_role;
