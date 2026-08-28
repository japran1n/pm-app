-- W2 (hardening): docs / doc_folders RLS did not gate on workspace_members.role,
-- only on active membership (public.is_active_workspace_member). Two bugs:
--
-- 1. The `client` role -- the EXTERNAL customer-facing role backing the
--    client portal -- is an active workspace_members row (see
--    20260902010000_client_role_and_task_client_visibility.sql) and
--    therefore had full SELECT/INSERT/UPDATE/DELETE on every internal doc
--    in the workspace, including workspace-level (project_id is null) docs
--    that have nothing to do with any client-visible project. A client
--    could hit PostgREST directly and read/edit/delete internal docs.
--
-- 2. The `viewer` role -- read-only everywhere else in the app (see
--    canWrite() in lib/auth/permissions.ts, which excludes both `viewer`
--    and `client`) -- could INSERT/UPDATE/DELETE docs and doc_folders via
--    direct PostgREST calls. The UI hid the buttons; the API did not.
--
-- Fix: add a role check alongside the existing active-membership +
-- project-visibility predicate (preserved verbatim from
-- 20260905020000_docs_project_visibility_rls.sql):
--   - SELECT: caller's role must not be 'client'
--   - INSERT/UPDATE/DELETE: caller's role must not be 'viewer' or 'client'
--
-- Reuses the existing helper-function convention (language sql, security
-- definer, set search_path = '', stable, fully-qualified public. refs,
-- grant execute to authenticated) rather than inlining a subquery into
-- eight policies. No existing helper in the codebase already expresses
-- "does this workspace member have write access" in a role-agnostic way
-- (is_workspace_admin is admin/owner-only, which is narrower than what
-- docs collaborative editing needs), so two small helpers are added here.
--
-- These helpers query workspace_members, not docs/doc_folders themselves,
-- so there is no risk of the 42P17 self-referential recursion that hit
-- channel_members RLS (see 20260904090000_fix_channel_members_rls.sql).

create or replace function public.can_read_workspace_docs(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role <> 'client'
  );
$$;

revoke all on function public.can_read_workspace_docs(uuid) from public;
grant execute on function public.can_read_workspace_docs(uuid) to authenticated;

create or replace function public.can_write_workspace_docs(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role not in ('viewer', 'client')
  );
$$;

revoke all on function public.can_write_workspace_docs(uuid) from public;
grant execute on function public.can_write_workspace_docs(uuid) to authenticated;

-- doc_folders

drop policy if exists doc_folders_select_active_members on doc_folders;
create policy doc_folders_select_active_members
  on doc_folders
  for select
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.can_read_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists doc_folders_insert_active_members on doc_folders;
create policy doc_folders_insert_active_members
  on doc_folders
  for insert
  to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists doc_folders_update_active_members on doc_folders;
create policy doc_folders_update_active_members
  on doc_folders
  for update
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists doc_folders_delete_active_members on doc_folders;
create policy doc_folders_delete_active_members
  on doc_folders
  for delete
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

-- docs

drop policy if exists docs_select_active_members on docs;
create policy docs_select_active_members
  on docs
  for select
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.can_read_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists docs_insert_active_members on docs;
create policy docs_insert_active_members
  on docs
  for insert
  to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists docs_update_active_members on docs;
create policy docs_update_active_members
  on docs
  for update
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists docs_delete_active_members on docs;
create policy docs_delete_active_members
  on docs
  for delete
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.can_write_workspace_docs(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );
