-- Re-applies two security migrations that never ran on production.
--
-- 20261127010000_workspace_members_column_grant_hardening.sql and
-- 20261127020000_ensure_task_type_revoke_authenticated.sql were shadowed:
-- production's supabase_migrations.schema_migrations already had those
-- versions recorded as `architecture_discipline_estimates` and
-- `architecture_node_meta`, from before those files were renumbered to
-- 20261127011000 / 20261127021000. scripts/apply-migration.mjs skipped by
-- version, so neither hardening statement ever reached the live database.
-- This leaves any member, including an external portal `client`, able to
-- PATCH their own workspace_members row to role='owner' through PostgREST.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. workspace_members: column-level UPDATE grant (re-applies 20261127010000)
-- ---------------------------------------------------------------------------
-- Only the two self-service columns stay writable by the session role. The
-- only user-scoped write in the app is lib/actions/status-note.ts
-- (status_note, status_note_until). Every other write goes through the
-- service-role admin client: role changes (lib/actions/workspaces.ts),
-- invite activation (lib/actions/invites.ts), portal_last_seen_at
-- (lib/queries/portal/overview.ts), seeds. It also goes through the
-- SECURITY DEFINER transfer_workspace_ownership (owner: postgres).
revoke update on public.workspace_members from authenticated, anon;
grant update (status_note, status_note_until) on public.workspace_members to authenticated;
-- Any future self-service column needs its own grant update (<col>) line.

-- ---------------------------------------------------------------------------
-- 2. workspace_members: guard trigger (defense in depth)
-- ---------------------------------------------------------------------------
-- The check uses current_user, not auth.role() or JWT claims. Legitimate
-- privileged writes run as service_role (admin client) or as the owner of a
-- SECURITY DEFINER function. In the second case the JWT still says
-- 'authenticated', but current_user is the function owner. Only a direct
-- session-role write (PostgREST as authenticated/anon) is refused.
create or replace function public.workspace_members_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.role               is distinct from old.role
    or new.status             is distinct from old.status
    or new.workspace_id       is distinct from old.workspace_id
    or new.user_id            is distinct from old.user_id
    or new.invited_email      is distinct from old.invited_email
    or new.invited_project_id is distinct from old.invited_project_id
  ) then
    raise exception 'workspace_members: role, status, workspace_id, user_id, invited_email and invited_project_id cannot be changed by the session role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.workspace_members_guard_privileged_columns() from public, anon, authenticated;

drop trigger if exists workspace_members_guard_privileged_columns on public.workspace_members;
create trigger workspace_members_guard_privileged_columns
  before update on public.workspace_members
  for each row execute function public.workspace_members_guard_privileged_columns();

-- ---------------------------------------------------------------------------
-- 3. ensure_task_type: revoke direct RPC (re-applies 20261127020000) and
--    add a caller-membership check
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, and it takes p_workspace_id as a plain argument. With
-- EXECUTE granted to authenticated, any signed-in user could call it as an
-- RPC and write a task_types row into any workspace.
--
-- Every application task insert goes through the admin client or a
-- SECURITY DEFINER function (owner: postgres), so the nested call from the
-- tasks_default_task_type trigger never runs as authenticated.
--
-- Defense in depth: when a request's JWT role is authenticated/anon (for
-- example a SECURITY DEFINER RPC that a member calls and that inserts a
-- task), the caller must be an active member of p_workspace_id.
-- service_role, cron and direct SQL have no such claim and pass unchanged.
create or replace function public.ensure_task_type(
  p_workspace_id uuid,
  p_system_key text,
  p_name text,
  p_color text,
  p_is_billable boolean,
  p_default_client_visible boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and not exists (
       select 1
         from public.workspace_members wm
        where wm.workspace_id = p_workspace_id
          and wm.user_id = auth.uid()
          and wm.status = 'active'
     ) then
    raise exception 'ensure_task_type: caller is not an active member of this workspace'
      using errcode = '42501';
  end if;

  select id into v_id
    from public.task_types
   where workspace_id = p_workspace_id
     and system_key = p_system_key;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.task_types (workspace_id, name, color, system_key, is_billable, default_client_visible)
  values (p_workspace_id, p_name, p_color, p_system_key, p_is_billable, p_default_client_visible)
  on conflict (workspace_id, system_key) where system_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
      from public.task_types
     where workspace_id = p_workspace_id
       and system_key = p_system_key;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.ensure_task_type(uuid, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.ensure_task_type(uuid, text, text, text, boolean, boolean) to service_role;
