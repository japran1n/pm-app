-- F320 (M15 fifth scrutiny pass, AS-389): public.create_notification()
-- validates the CALLER (auth.uid()/workspace membership, see
-- 20260823100000_fix_create_notification_system_bypass.sql) and the
-- RECIPIENT (workspace membership) but never checked that `p_task_id`,
-- when provided, actually belongs to a project inside `p_workspace_id`.
-- A caller (or a buggy internal caller) could attach a task id from a
-- completely different workspace to a notification -- not a direct
-- cross-user data leak (the recipient's own membership in
-- `p_workspace_id` is still enforced separately, and RLS still scopes
-- what that recipient can read), but a data-integrity hole: a
-- notification's `task_id` FK would silently reference a task the
-- notification's own `workspace_id` has nothing to do with, which the
-- reading UI (F206's panel, which joins task_id to render a task-scoped
-- notification) is not written to expect.
--
-- Mirrors the cross-entity consistency-check pattern other write paths
-- in this codebase already use (e.g. bulkUpdateTasks/addComment's own
-- "does this id actually belong to the project/workspace I claim it
-- does" checks) -- raise an exception rather than silently accepting a
-- mismatched task_id. `p_kind`'s own validity is still enforced entirely
-- by `notifications_kind_check` at insert time (unchanged) -- that
-- CHECK constraint already rejects any value outside the closed
-- vocabulary; this migration does not duplicate that, only makes the
-- task_id/workspace cross-check that constraint has no equivalent for.
--
-- Signature is unchanged -- only the internal validation logic changes --
-- so `create or replace function` is sufficient.
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

  -- F320: a provided task_id must belong to a project inside the target
  -- workspace -- prevents a notification whose task_id and workspace_id
  -- disagree about which workspace they belong to.
  if p_task_id is not null then
    if not exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = p_task_id
        and p.workspace_id = p_workspace_id
    ) then
      raise exception 'create_notification: task % does not belong to workspace %', p_task_id, p_workspace_id;
    end if;
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
