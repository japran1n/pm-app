-- F112 (missions/20260903-portal, six-star review Part 0/D): "Roles — who
-- does what on this project". Workspace roles (owner/admin/member/viewer/
-- client, `workspace_members.role`) and `project_members.project_role`
-- (`lead`|`member`) are both PERMISSIONS. Neither one names a job — a
-- `member` can be the project's design lead without gaining any rights,
-- and one person can hold two jobs on one project (`design lead` +
-- `developer`) and none on another. This migration adds `project_roles`
-- (project x user x role) to carry that, separate from both.
--
-- `project_decision_owners` (20260916010000) already exists and is
-- adjacent but different: it names who has AUTHORITY OVER a decision type
-- (content/brand/technical/commercial), always a CLIENT
-- (setDecisionOwner, lib/actions/approvals.ts:566, checks
-- `getProjectClientMembers`), one owner per decision type. `project_roles`
-- names an AGENCY TEAM MEMBER's job title, any number of roles per person,
-- read from a completely disjoint table by a completely disjoint query
-- (getPortalTeam vs getDecisionOwners) rendered in a completely disjoint
-- card (Your team vs Who approves what/decision-owner badges). Neither
-- table is ever derived from the other and no query joins them, so the
-- portal cannot contradict itself between them — there is nothing to
-- reconcile, only two facts that are allowed to coexist about the same
-- person (e.g. Nina's coworker could in principle be both a project
-- "developer" and, on a different project, a client decision owner; the
-- two tables model different people in practice here, but the schema
-- does not need to prevent overlap because neither view claims to be the
-- other's answer).
--
-- Role vocabulary: a fixed CHECK constraint, not a workspace-configurable
-- table. The agency named exactly six jobs (PM, team lead, design lead,
-- Webflow lead, designer, developer per docs/client-portal-six-star-
-- review.md Part 0/D and docs/client-portal-phase-2-plan.md section D) --
-- the same "closed list, not configurable" choice this schema already
-- makes for `approval_requests.decision_type` (four fixed values, no
-- per-workspace decision-type table) and `notifications.kind`. A fixed
-- list is simpler (no new settings page, no per-workspace CRUD, no
-- migration-shaped hole for a workspace to invent a role the portal's UI
-- has no icon/label for) at the cost that a seventh role name needs a
-- migration -- the same trade this codebase has already made twice for
-- comparably-sized closed vocabularies, and the spec's own text ("Decide
-- whether it is a fixed check constraint or workspace-configurable, and
-- defend the choice") only asks for a defended choice, not the
-- configurable one.
--
-- "What they own" (the one-line description on the portal card): free
-- text on the role row (`project_roles.note`), not derived. There is no
-- existing structured source to derive it from -- `project_phases` is
-- project-wide, not person-scoped, and `tasks.assignee` has no notion of
-- "the thing they own" as opposed to "the thing they're doing this week".
-- Free text lets a PM write "Homepage & product listing pages" or
-- "Client-side Webflow build" without inventing a new taxonomy this
-- feature has no other consumer for.
--
-- Every SECURITY DEFINER identity this migration touches is a REUSE of
-- existing predicates (`is_project_visible_to`, `is_project_client`,
-- `is_project_portal_enabled`, `is_project_workspace_writer`, all pinned
-- `search_path = public, pg_temp` since 20260908010000) -- no new
-- SECURITY DEFINER function is added here, so there is nothing new to pin.

create table if not exists project_roles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  note text,
  added_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_roles_role_check check (
    role in ('pm', 'team_lead', 'design_lead', 'webflow_lead', 'designer', 'developer')
  ),
  -- One row per (project, person, job) -- the same person can hold a
  -- second, different role on the same project (a second insert with a
  -- different `role` value), but not the same role twice.
  constraint project_roles_project_user_role_unique unique (project_id, user_id, role)
);

drop trigger if exists project_roles_set_updated_at on project_roles;
create trigger project_roles_set_updated_at
  before update on project_roles
  for each row
  execute function set_updated_at();

create index if not exists project_roles_project_id_idx on project_roles (project_id);

-- ---------------------------------------------------------------------
-- RLS: project_roles
-- ---------------------------------------------------------------------
-- Team: same `is_project_visible_to(project_id) and not
-- is_project_client(project_id)` SELECT shape, and `is_project_workspace_
-- writer(project_id)` write shape, that `project_decision_owners` already
-- uses (20260916010000) -- this table sits beside that one in project
-- settings per this feature's own spec, so it reuses the identical
-- predicate set rather than inventing a second one.
--
-- Client SELECT: membership + project visibility + portal_enabled, same
-- as `project_decision_owners_select_client` -- a client reads exactly
-- their own project's rows and nothing from any other project (verified
-- by this migration's own failing-case test,
-- tests/integration/f112-project-roles-rls.test.ts, which signs in as a
-- client of project A and asserts a read against project B's roles comes
-- back empty, matching RLS's row-filtering rather than an explicit deny).
-- No client write of any kind -- this is a team-assigned job title, not
-- something a client sets.

alter table project_roles enable row level security;

drop policy if exists project_roles_select_team on project_roles;
create policy project_roles_select_team
  on project_roles
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_roles_select_client on project_roles;
create policy project_roles_select_client
  on project_roles
  for select
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_roles_insert_team on project_roles;
create policy project_roles_insert_team
  on project_roles
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_roles_update_team on project_roles;
create policy project_roles_update_team
  on project_roles
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_roles_delete_team on project_roles;
create policy project_roles_delete_team
  on project_roles
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- Allow-list column guard sweep (F006k/F016j precedent, most recently
-- 20261017010000_f020b_projects_allowlist_guard.sql)
-- ---------------------------------------------------------------------
-- `project_roles` is a brand-new table with no pre-existing field-role
-- trigger of its own, and this migration adds no column to `projects`,
-- `client_requests`, or `approval_requests` (the three tables that carry
-- an allow-list/field-role guard in this schema) -- so no guard sweep
-- applies here. Noted explicitly per this feature's own instruction to
-- check.
