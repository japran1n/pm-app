-- F227: saved_views table + RLS (AS-426, AS-427, AS-434).
--
-- A saved view captures a set of filters, sort order, and grouping under a
-- name, per this feature's Clarified implementation answer #2 (typed
-- columns for everything the RLS/index layer needs to reason about --
-- scope, project_id, view_type, is_default -- with a single jsonb `config`
-- column for the filters/sort/grouping payload itself, since that payload
-- is read/written atomically by the client and has no column the DB layer
-- needs to index or constrain beyond "is it well-formed JSON shaped like a
-- view config"). This is deliberately NOT a single jsonb blob for the
-- whole row (rejected option (b) in the clarification round): scope and
-- project_id must be real columns because RLS predicates and FKs need to
-- reason about them directly, not reach into JSON.
--
-- AUTONOMOUS_DECISION (Notes for clarification: "config shape must cover
-- filters, sort, grouping, and view type ... from the start"): `config`
-- carries filters/sort/grouping (an open-ended, evolving shape best owned
-- by the Zod schema in lib/validation/views.ts, not fixed at the DB layer
-- since new filter types will be added by later features without a
-- migration each time), while `view_type` (board/list/calendar/timeline)
-- is its own typed, CHECK-constrained column since it drives which reader
-- component mounts and several features (F228/F229) will filter/index on
-- it directly. This is the simpler option that adds no new dependency and
-- no second source of truth for the fields RLS/FKs/queries need typed.
--
-- Visibility (AS-427, AS-429, AS-434): a saved view is 'personal' or
-- 'shared'. A personal view is visible to nobody but its owner_id --
-- enforced by RLS alone, with no is_project_visible_to escape hatch, so a
-- personal view is invisible to others "including via a direct query"
-- (AS-434) regardless of project visibility. A shared view scoped to a
-- project (project_id is not null) reuses the shared SQL helper
-- `public.is_project_visible_to(project_id)`
-- (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql)
-- rather than a copy-pasted predicate, per this feature's Clarified
-- implementation answer #9 -- a shared view can never be visible to
-- someone who cannot see the project it belongs to. A shared
-- workspace-level view (project_id is null) is visible to every active
-- workspace member via `public.is_active_workspace_member(workspace_id)`
-- (supabase/migrations/20260817222822_rls_workspaces.sql), the existing
-- workspace-membership helper.
--
-- Full select/insert/update/delete sweep (not SELECT-only), matching the
-- visibility-sweep migration's corrected style -- a saved view is written
-- through this table's own RLS (no admin-client bypass in this feature;
-- F228 is responsible for keeping that seam clean per this feature's
-- Notes for the next worker).
--
-- FKs: workspace_id/project_id/owner_id all `on delete cascade` -- a
-- saved view has no independent lifecycle once its workspace, project, or
-- owning user is gone. Verified against F219's "last-row guard vs.
-- cascade" lesson below: this migration adds NO guard/trigger blocking
-- deletion of the last saved view (there is no "a project/workspace must
-- always have at least one view" invariant anywhere in this feature's
-- assertions), so project/user hard-delete is never blocked by this
-- table -- confirmed by the delete-cascade tests in
-- tests/integration/rls-saved-views.test.ts.

create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  scope text not null default 'personal' check (scope in ('personal', 'shared')),
  view_type text not null default 'list'
    check (view_type in ('board', 'list', 'calendar', 'timeline')),
  config jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_views_name_not_empty check (btrim(name) <> ''),
  -- config must be a JSON object (never an array/scalar) so the
  -- application-layer Zod schema (lib/validation/views.ts) always has a
  -- key/value shape to parse -- the DB-level backstop per this repo's "the
  -- DB is the last line, not the only line" convention.
  constraint saved_views_config_is_object check (jsonb_typeof(config) = 'object')
);

comment on table public.saved_views is
  'F227: named, saved filter/sort/grouping views (AS-426, AS-427, AS-434). scope=personal is visible only to owner_id; scope=shared is visible to the project (project_id set) or the whole workspace (project_id null) per the RLS policies below.';

-- Performance budget (Clarified implementation #8): index every FK plus
-- the columns the main read paths (F228/F229) filter/order by -- "all
-- views visible to this caller for this project/workspace", and "this
-- user's default view for this project".
create index if not exists saved_views_workspace_id_idx
  on public.saved_views (workspace_id);
create index if not exists saved_views_project_id_idx
  on public.saved_views (project_id);
create index if not exists saved_views_owner_id_idx
  on public.saved_views (owner_id);
create unique index if not exists saved_views_owner_default_per_project_idx
  on public.saved_views (owner_id, project_id)
  where is_default;

drop trigger if exists saved_views_set_updated_at on public.saved_views;
create trigger saved_views_set_updated_at
  before update on public.saved_views
  for each row
  execute function set_updated_at();

alter table public.saved_views enable row level security;

-- SELECT: the owner always sees their own views (personal or shared).
-- Everyone else sees only 'shared' views, gated by project visibility
-- when project-scoped, or workspace membership when workspace-scoped.
drop policy if exists saved_views_select_visible on public.saved_views;
create policy saved_views_select_visible
  on public.saved_views
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or (
      scope = 'shared'
      and (
        (project_id is not null and public.is_project_visible_to(project_id))
        or (project_id is null and public.is_active_workspace_member(workspace_id))
      )
    )
  );

-- INSERT: a caller may only create views attributed to themselves, and
-- only where they otherwise have visibility (project-visible, or an
-- active member of the workspace for a workspace-level view).
drop policy if exists saved_views_insert_visible on public.saved_views;
create policy saved_views_insert_visible
  on public.saved_views
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and (
      (project_id is not null and public.is_project_visible_to(project_id))
      or (project_id is null and public.is_active_workspace_member(workspace_id))
    )
  );

-- UPDATE: only the owner may update their own view (AS-430's "creator or
-- admin" rule for shared views is enforced at the Server Action layer in
-- F228, which re-checks role via canManageColumns-style helpers before
-- calling through as the admin client where an admin-not-owner edit is
-- required -- RLS here stays the simple, unbypassable "owner only" floor).
drop policy if exists saved_views_update_own on public.saved_views;
create policy saved_views_update_own
  on public.saved_views
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- DELETE: same floor as UPDATE -- owner only via RLS; admin-delete of a
-- shared view (AS-430) is an F228 admin-client path with its own
-- application-layer role check, same seam as UPDATE above.
drop policy if exists saved_views_delete_own on public.saved_views;
create policy saved_views_delete_own
  on public.saved_views
  for delete
  to authenticated
  using (owner_id = auth.uid());

-- No policy for anon: absence of a matching policy denies access by
-- default under RLS, matching this repo's established convention.
