-- F006n (missions/20260903-portal, M1 remediation round 3 — blocker):
-- closes five SECURITY DEFINER functions, each granted to `authenticated`,
-- each with zero authorisation checks in their bodies. F006l's class sweep
-- (missions/20260903-portal/handoffs/F006l-handoff.md) found and reported
-- these; they were explicitly out of that feature's scope and filed as a
-- SUGGESTED FOLLOWUP, which this feature now closes.
--
-- All five predate the portal, when "any authenticated user" meant "a
-- colleague" — the missing checks were a latent bug inside a trust
-- boundary that no longer exists once clients are authenticated users too.
--
-- Convention followed throughout: mirror the calling Server Action's own
-- authorisation, never invent a new bar. Four of the five
-- (bulk_delete_tasks_atomic, duplicate_task_atomic, restore_task_atomic,
-- set_task_assignees_atomic) are invoked by their Server Actions via the
-- ADMIN client (service_role) — auth.uid() is null on that path, exactly
-- like create_channel_atomic (20260918010000_f006i_authz_round_2.sql,
-- "1. seed_default_phases" comment block, section 4): the check is
-- wrapped in `if auth.uid() is not null then ... end if;` so a direct
-- `authenticated`-role PostgREST call is authorised here, while the
-- existing service_role call path (already independently re-checked by
-- its Server Action) is left untouched. accept_client_request_atomic is
-- the one exception: its Server Action calls it via the caller's OWN
-- session (`supabase.rpc`, not `admin.rpc` — lib/actions/client-requests.ts
-- acceptClientRequest), so auth.uid() is always the real caller there and
-- the check runs unconditionally, the same shape
-- assert_portal_task_actionable_by_client already uses.
--
-- ---------------------------------------------------------------------
-- 1. bulk_delete_tasks_atomic — mirrors bulkDeleteTasks
-- (lib/actions/tasks.ts): per task, `canWrite` (role not viewer, not
-- client — public.is_task_workspace_writer already encodes exactly this
-- rule) AND project visibility (public.is_project_visible_to, which
-- covers the private-project explicit-member case bulkDeleteTasks checks
-- by hand). A task failing either check is silently excluded from the
-- delete (and its cascade), never raises — matching bulkDeleteTasks's own
-- per-task partial-success contract (failedIds vs succeededIds), which a
-- hard `raise exception` would break for the legitimate mixed-batch case.
-- ---------------------------------------------------------------------

create or replace function public.bulk_delete_tasks_atomic(
  p_task_ids   uuid[],
  p_deleted_by uuid,
  p_deleted_at timestamptz
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed_ids uuid[];
  v_deleted_ids uuid[];
begin
  if auth.uid() is not null then
    -- Direct `authenticated` caller: narrow p_task_ids down to only the
    -- ids this caller is actually allowed to delete, same predicate
    -- bulkDeleteTasks applies itself before ever calling this RPC.
    select array_agg(t.id) into v_allowed_ids
    from public.tasks t
    where t.id = any(p_task_ids)
      and public.is_task_workspace_writer(t.id)
      and public.is_project_visible_to(t.project_id);

    -- Also pin the attribution to the real caller — a direct caller must
    -- not be able to attribute a delete to someone else.
    p_deleted_by := auth.uid();
  else
    -- service_role call path (admin.rpc from bulkDeleteTasks): the
    -- Server Action has already filtered p_task_ids down to allowedIds
    -- and re-verified them itself; trust it, same as create_channel_atomic
    -- trusts its own service_role caller.
    v_allowed_ids := p_task_ids;
  end if;

  if v_allowed_ids is null or array_length(v_allowed_ids, 1) is null then
    return '{}';
  end if;

  with deleted as (
    update public.tasks
    set deleted_at = p_deleted_at,
        deleted_by = p_deleted_by
    where id = any(v_allowed_ids)
      and deleted_at is null
    returning id
  )
  select array_agg(id) into v_deleted_ids from deleted;

  if v_deleted_ids is not null and array_length(v_deleted_ids, 1) > 0 then
    update public.tasks
    set deleted_at = p_deleted_at,
        deleted_by = p_deleted_by
    where parent_task_id = any(v_deleted_ids)
      and deleted_at is null;
  end if;

  return coalesce(v_deleted_ids, '{}');
end;
$$;

revoke all on function public.bulk_delete_tasks_atomic(uuid[], uuid, timestamptz) from public;
grant execute on function public.bulk_delete_tasks_atomic(uuid[], uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 2. duplicate_task_atomic — mirrors duplicateTaskImpl's withAuthz gate
-- (requireWrite: canWrite, requireVisibility: true): a direct caller must
-- be an active, non-viewer, non-client workspace member who can also see
-- the source task's project.
-- ---------------------------------------------------------------------

create or replace function public.duplicate_task_atomic(
  p_source_task_id uuid,
  p_new_task_id    uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    if not public.is_task_workspace_writer(p_source_task_id) then
      raise exception 'duplicate_task_atomic: caller does not have write access to the source task'
        using errcode = '42501';
    end if;

    if not public.is_project_visible_to(
      (select t.project_id from public.tasks t where t.id = p_source_task_id)
    ) then
      raise exception 'duplicate_task_atomic: caller does not have access to this task''s project'
        using errcode = '42501';
    end if;
  end if;

  insert into public.checklist_items (task_id, content, position)
  select p_new_task_id, content, position
  from public.checklist_items
  where task_id = p_source_task_id;

  insert into public.task_assignees (task_id, user_id, assigned_by)
  select p_new_task_id, user_id, assigned_by
  from public.task_assignees
  where task_id = p_source_task_id;
end;
$$;

revoke all on function public.duplicate_task_atomic(uuid, uuid) from public;
grant execute on function public.duplicate_task_atomic(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. restore_task_atomic — mirrors restoreTaskImpl's withAuthz gate
-- (requireWrite: canWrite, requireVisibility: true), same bar as
-- duplicate_task_atomic above. is_task_workspace_writer joins `tasks`
-- without filtering on deleted_at, so it works correctly here even
-- though the target row is currently soft-deleted.
-- ---------------------------------------------------------------------

create or replace function public.restore_task_atomic(
  p_task_id uuid
)
returns table (
  id uuid,
  project_id uuid,
  status text,
  "position" float8,
  status_was_reset boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_current_status text;
  v_resolved_status text;
  v_status_was_reset boolean;
  v_last_position float8;
  v_new_position float8;
  v_known_statuses text[] := array['todo', 'in_progress', 'in_review', 'done'];
  v_child record;
  v_child_resolved_status text;
  v_child_last_position float8;
  v_child_position float8;
begin
  if auth.uid() is not null then
    if not public.is_task_workspace_writer(p_task_id) then
      raise exception 'restore_task_atomic: caller does not have write access to this task'
        using errcode = '42501';
    end if;

    if not public.is_project_visible_to(
      (select t.project_id from public.tasks t where t.id = p_task_id)
    ) then
      raise exception 'restore_task_atomic: caller does not have access to this task''s project'
        using errcode = '42501';
    end if;
  end if;

  select t.project_id, t.status
    into v_project_id, v_current_status
  from public.tasks t
  where t.id = p_task_id
    and t.deleted_at is not null
  for update;

  if v_project_id is null then
    return;
  end if;

  v_status_was_reset := not (v_current_status = any(v_known_statuses));
  v_resolved_status := case when v_status_was_reset then 'todo' else v_current_status end;

  select t."position"
    into v_last_position
  from public.tasks t
  where t.project_id = v_project_id
    and t.status = v_resolved_status
    and t.deleted_at is null
  order by t."position" desc
  limit 1;

  v_new_position := coalesce(v_last_position, 0) + 1000;

  update public.tasks
  set deleted_at = null,
      deleted_by = null,
      status = v_resolved_status,
      "position" = v_new_position
  where public.tasks.id = p_task_id;

  for v_child in
    select t.id, t.status
    from public.tasks t
    where t.deleted_via_task_id = p_task_id
      and t.deleted_at is not null
  loop
    v_child_resolved_status := case
      when v_child.status = any(v_known_statuses) then v_child.status
      else 'todo'
    end;

    select t."position"
      into v_child_last_position
    from public.tasks t
    where t.project_id = v_project_id
      and t.status = v_child_resolved_status
      and t.deleted_at is null
    order by t."position" desc
    limit 1;

    v_child_position := coalesce(v_child_last_position, 0) + 1000;

    update public.tasks
    set deleted_at = null,
        deleted_by = null,
        deleted_via_task_id = null,
        status = v_child_resolved_status,
        "position" = v_child_position
    where public.tasks.id = v_child.id;
  end loop;

  return query
  select p_task_id, v_project_id, v_resolved_status, v_new_position, v_status_was_reset;
end;
$$;

revoke all on function public.restore_task_atomic(uuid) from public;
grant execute on function public.restore_task_atomic(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. set_task_assignees_atomic — mirrors requireAssignActionContext
-- (lib/actions/tasks.ts): active membership + `canEditTask` (excludes
-- viewer AND guest, in addition to client — stricter than plain
-- canWrite, so is_task_workspace_writer alone is not enough here) +
-- project visibility.
-- ---------------------------------------------------------------------

create or replace function public.set_task_assignees_atomic(
  p_task_id      uuid,
  p_desired_user_ids uuid[],
  p_assigned_by  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mirror_id uuid;
  v_project_id uuid;
  v_workspace_id uuid;
  v_caller_role text;
begin
  if auth.uid() is not null then
    select t.project_id, p.workspace_id
      into v_project_id, v_workspace_id
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where t.id = p_task_id;

    if v_project_id is null then
      raise exception 'set_task_assignees_atomic: task not found'
        using errcode = '42501';
    end if;

    select wm.role into v_caller_role
      from public.workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = auth.uid()
       and wm.status = 'active';

    -- canEditTask: owner/admin/member only — viewer, guest, and client
    -- are all excluded (lib/auth/permissions.ts).
    if v_caller_role is null or v_caller_role not in ('owner', 'admin', 'member') then
      raise exception 'set_task_assignees_atomic: caller does not have permission to change this task''s assignees'
        using errcode = '42501';
    end if;

    if not public.is_project_visible_to(v_project_id) then
      raise exception 'set_task_assignees_atomic: caller does not have access to this task''s project'
        using errcode = '42501';
    end if;

    -- A direct caller must not be able to attribute the assignment to
    -- someone else.
    p_assigned_by := auth.uid();
  end if;

  delete from public.task_assignees
  where task_id = p_task_id
    and user_id <> all(p_desired_user_ids);

  insert into public.task_assignees (task_id, user_id, assigned_by)
  select p_task_id, u, p_assigned_by
  from unnest(p_desired_user_ids) as u
  on conflict (task_id, user_id) do nothing;

  select user_id into v_mirror_id
  from public.task_assignees
  where task_id = p_task_id
  order by created_at, user_id
  limit 1;

  update public.tasks
  set assignee_id = v_mirror_id
  where id = p_task_id;

  return v_mirror_id;
end;
$$;

revoke all on function public.set_task_assignees_atomic(uuid, uuid[], uuid) from public;
grant execute on function public.set_task_assignees_atomic(uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. accept_client_request_atomic — mirrors acceptClientRequest's own
-- checks (lib/actions/client-requests.ts): active workspace membership
-- + `teamCanTriage` (canWrite && !isClient — role not viewer, not
-- client). This RPC already runs as the caller's own session
-- (supabase.rpc, not admin.rpc), so auth.uid() is always the real caller
-- and the check is unconditional, no service_role branch needed.
--
-- Additionally, per this feature's own scope: the `portal_enabled` gate
-- (a request can only be accepted on a project whose portal is on — the
-- Server Action doesn't check this today, but it should have, the same
-- shape F006l/F006i already applied to every other portal-adjacent
-- write path) and an explicit role bar so a client can never accept
-- their own request (redundant with `teamCanTriage` today since
-- `canWrite`/`teamCanTriage` already excludes the client role
-- unconditionally, but named explicitly and separately below so a future
-- change to `teamCanTriage` that widens it for clients does not silently
-- also widen this).
--
-- NOTE FOR F016 (M3, change-request pricing hardening): this function's
-- shape is now membership -> role bar -> portal gate -> row lock ->
-- mutate. F016 will need to add a pricing-specific check somewhere in
-- that same sequence (most naturally right after the portal gate, before
-- the row lock) — see this migration's own structure as the template,
-- do not re-derive the auth preamble from scratch.
-- ---------------------------------------------------------------------

create or replace function public.accept_client_request_atomic(
  p_request_id uuid
)
returns table (task_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_title text;
  v_body text;
  v_desired_by date;
  v_status text;
  v_task_id uuid;
  v_caller_role text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select cr.project_id, cr.title, cr.body, cr.desired_by, cr.status, p.workspace_id
    into v_project_id, v_title, v_body, v_desired_by, v_status, v_workspace_id
    from public.client_requests cr
    join public.projects p on p.id = cr.project_id
   where cr.id = p_request_id
     for update of cr;

  if v_project_id is null then
    raise exception 'request not found';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active';

  -- teamCanTriage (lib/actions/client-requests.ts): canWrite && !isClient
  -- — role not viewer, not client. Named as two explicit conditions (not
  -- just "role not in (viewer, client)") so a client is barred from
  -- accepting even their own request under a role predicate that can
  -- never accidentally admit 'client' by omission.
  if v_caller_role is null or v_caller_role = 'viewer' or v_caller_role = 'client' then
    raise exception 'caller does not have permission to review requests'
      using errcode = '42501';
  end if;

  -- Extra bar per this feature's scope: a client must never accept their
  -- own request, stated as its own explicit check even though the role
  -- bar above already makes it unreachable today.
  if v_caller_role = 'client' then
    raise exception 'a client cannot accept their own request'
      using errcode = '42501';
  end if;

  if not public.is_project_portal_enabled(v_project_id) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if v_status = 'accepted' then
    raise exception 'request already accepted';
  end if;

  insert into public.tasks (project_id, title, description, status, author_id, due_date, client_visible)
  values (v_project_id, v_title, v_body, 'todo', v_user_id, v_desired_by, true)
  returning id into v_task_id;

  update public.client_requests
     set status = 'accepted',
         decline_reason = null,
         converted_task_id = v_task_id,
         reviewed_by = v_user_id,
         reviewed_at = now()
   where id = p_request_id;

  return query select v_task_id;
end;
$$;

revoke all on function public.accept_client_request_atomic(uuid) from public;
grant execute on function public.accept_client_request_atomic(uuid) to authenticated;
