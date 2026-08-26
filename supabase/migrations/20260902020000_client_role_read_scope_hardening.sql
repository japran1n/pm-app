-- C2 follow-up: close every read path a `client` should not have.
--
-- 20260902010000 extended the shared visibility predicates, which covered
-- tasks and everything hanging off `is_task_visible_to`. Verifying it
-- against a real client session (signing in as the demo client and querying
-- each table through PostgREST) showed three categories it did NOT cover,
-- all found by testing rather than by reading the schema:
--
--   1. `is_project_visible_to_row` — a SECOND copy of the project
--      visibility rule, used by the `projects` SELECT policy, which still
--      had the old `role <> 'guest'` test. A client saw every
--      workspace-visible project, including ones they were never added to.
--      This is exactly the duplicated-predicate drift the plan warned
--      about; both copies are now fixed, and the duplication itself is
--      noted below for a later cleanup.
--
--   2. Team-internal facts reachable from a task the client CAN see:
--      logged time and billability, running timers, who is assigned, who
--      is watching, and the internal activity feed. Each of these routes
--      through `is_task_visible_to`, so extending that predicate had
--      correctly bounded them to shared tasks — but a shared task's
--      *internal* metadata is still internal.
--
--   3. Roster reads: `workspace_members`, `project_members`, `profiles`,
--      task templates and shared saved views. A client could enumerate the
--      whole team and every other member's role.
--
-- The convention throughout is `<existing predicate> and not
-- <is_..._client>(...)`, so nothing changes for any team role: for them
-- the added conjunct is constantly true.

-- ---------------------------------------------------------------------
-- Predicates
-- ---------------------------------------------------------------------

create or replace function public.is_workspace_client(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role = 'client'
  );
$$;

create or replace function public.is_task_client(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role = 'client'
  );
$$;

-- True when the caller shares a workspace with the target user in which the
-- CALLER is not a client. Someone can be a client of one workspace and a
-- teammate in another, so "is this person a client" must be asked per
-- workspace, never globally.
create or replace function public.shares_non_client_workspace_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members caller_membership
    join public.workspace_members target_membership
      on target_membership.workspace_id = caller_membership.workspace_id
    join public.workspaces w
      on w.id = caller_membership.workspace_id
    where caller_membership.user_id = auth.uid()
      and caller_membership.status = 'active'
      and caller_membership.role <> 'client'
      and target_membership.user_id = target_user_id
      and target_membership.status = 'active'
      and w.deleted_at is null
  );
$$;

-- ---------------------------------------------------------------------
-- 1. The duplicated project-visibility rule
-- ---------------------------------------------------------------------
-- NOTE: this is a byte-for-byte duplicate of `is_project_visible_to`'s
-- logic, kept only because the `projects` policy passes the row's columns
-- in directly to avoid a self-referential lookup. Any future change to
-- project visibility MUST be made in both. Collapsing the two into one
-- implementation is worth doing on its own, but is deliberately not done
-- inside a security fix.

create or replace function public.is_project_visible_to_row(
  target_project_id uuid,
  target_workspace_id uuid,
  target_visibility text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        (
          wm.role not in ('guest', 'client')
          and (
            target_visibility = 'workspace'
            or wm.role in ('owner', 'admin')
          )
        )
        or exists (
          select 1
          from project_members pm
          where pm.project_id = target_project_id
            and pm.user_id = auth.uid()
        )
      )
  );
$$;

-- ---------------------------------------------------------------------
-- 2. Internal metadata on tasks the client can see
-- ---------------------------------------------------------------------

drop policy if exists time_entries_select_active_members on time_entries;
create policy time_entries_select_active_members
  on time_entries
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
    and not public.is_task_client(task_id)
  );

drop policy if exists active_timers_select_active_members on active_timers;
create policy active_timers_select_active_members
  on active_timers
  for select
  to authenticated
  using (
    public.is_task_workspace_member(task_id)
    and not public.is_task_client(task_id)
  );

drop policy if exists task_activity_select_visible_task on task_activity;
create policy task_activity_select_visible_task
  on task_activity
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
    and not public.is_task_client(task_id)
  );

drop policy if exists task_assignees_select_visible on task_assignees;
create policy task_assignees_select_visible
  on task_assignees
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
    and not public.is_task_client(task_id)
  );

drop policy if exists task_watchers_select_visible on task_watchers;
create policy task_watchers_select_visible
  on task_watchers
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
    and not public.is_task_client(task_id)
  );

-- ---------------------------------------------------------------------
-- 3. Roster reads
-- ---------------------------------------------------------------------
-- A client keeps read access to their OWN membership row: the app reads it
-- to learn the caller's role (that is how the portal decides it is a
-- portal). Everyone else's row disappears.

drop policy if exists workspace_members_select_fellow_members on workspace_members;
create policy workspace_members_select_fellow_members
  on workspace_members
  for select
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      not public.is_workspace_client(workspace_id)
      or user_id = auth.uid()
    )
  );

drop policy if exists project_members_select_active_members on project_members;
create policy project_members_select_active_members
  on project_members
  for select
  to authenticated
  using (
    public.is_project_workspace_member(project_id)
    and (
      not public.is_project_client(project_id)
      or user_id = auth.uid()
    )
  );

drop policy if exists profiles_select_self_or_shared_workspace on profiles;
create policy profiles_select_self_or_shared_workspace
  on profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.shares_non_client_workspace_with(id)
  );

-- Templates are an internal authoring tool. The existing policy excluded
-- guests; clients belong in the same bucket.
drop policy if exists task_templates_select_non_guest_members on task_templates;
create policy task_templates_select_non_guest_members
  on task_templates
  for select
  to authenticated
  using (
    exists (
      select 1
      from workspace_members wm
      where wm.workspace_id = task_templates.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role not in ('guest', 'client')
    )
  );

-- A shared saved view is a team artefact (its filters can name assignees
-- and internal tags). A client's own views are still their own, which is
-- what the `owner_id = auth.uid()` branch preserves.
drop policy if exists saved_views_select_visible on saved_views;
create policy saved_views_select_visible
  on saved_views
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or (
      scope = 'shared'
      and (
        (project_id is not null and public.is_project_visible_to(project_id)
          and not public.is_project_client(project_id))
        or (project_id is null and public.is_active_workspace_member(workspace_id)
          and not public.is_workspace_client(workspace_id))
      )
    )
  );
