-- Sidebar drag-and-drop reorder for projects (workspace-global, not
-- per-member -- per this feature's clarified "simpler option" scope:
-- one shared order for every workspace member, no per-user override).
--
-- `sidebar_position` is nullable at the schema level so any INSERT that
-- doesn't set it explicitly (every existing `createProject` call site,
-- unchanged by this migration) doesn't need updating -- the query layer
-- (lib/queries/projects.ts's getWorkspaceProjects) already falls back to
-- `created_at desc` for any row where this is null, so a freshly created
-- project keeps rendering (at the end of the list, sorted after every
-- positioned row) even before it's ever been dragged.
alter table projects
  add column if not exists sidebar_position integer;

-- Backfill every existing, non-deleted project with a sequential position
-- per workspace, ordered by the SAME `created_at desc` order the sidebar
-- already renders in today -- so applying this migration never visibly
-- reorders anyone's existing sidebar.
--
-- `projects`' own allow-list guard trigger
-- (`projects_enforce_field_role_allowlist`, 20261017010000_f020b_
-- projects_allowlist_guard.sql, tightened by 20261019010000/
-- 20261022010000) fires on every UPDATE regardless of the connecting
-- role -- it only recognizes `auth.role() = 'service_role'` (a
-- PostgREST/JWT-context signal that doesn't exist in a plain migration
-- run) or a transaction-local `app.projects_field_guard_bypass` GUC as a
-- bypass, and the Supabase CLI's migration runner does not guarantee
-- this statement and the UPDATE below share one transaction/session (a
-- `set_config(..., true|false)` attempt here was tried and silently
-- didn't stick across statements). Disabling the trigger for the
-- duration of this single backfill UPDATE, then re-enabling it
-- immediately after, sidesteps that without weakening the guard for any
-- real application write -- this migration is the only caller that ever
-- touches `sidebar_position` before it's added to that guard's
-- MEMBER-tier allow-list (which it deliberately never is: sidebar
-- ordering is fully app-controlled via lib/actions/projects.ts's
-- `reorderProject`, which writes through the service_role-bypassed admin
-- client, not a plain member session).
alter table projects disable trigger projects_enforce_field_role_allowlist;

with ranked as (
  select
    id,
    row_number() over (
      partition by workspace_id
      order by created_at desc, id
    ) - 1 as rn
  from projects
  where deleted_at is null
)
update projects
set sidebar_position = ranked.rn
from ranked
where projects.id = ranked.id
  and projects.sidebar_position is null;

alter table projects enable trigger projects_enforce_field_role_allowlist;

-- Lookup index for the sidebar's own per-workspace ordered query
-- (mirrors the existing `project_statuses_project_id_position_idx` /
-- `saved_views_project_id_view_type_position_idx` convention already used
-- elsewhere in this schema for the same "ordered list scoped by a parent
-- id" shape).
create index if not exists projects_workspace_id_sidebar_position_idx
  on projects (workspace_id, sidebar_position);
