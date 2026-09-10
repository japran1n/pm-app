-- Mission 20260910-182104, F003: RLS policies for `page_components`.
-- 20261121010000_f002_page_components.sql created the table with RLS
-- ENABLED but zero policies (deliberately deferred to this migration).
-- This migration writes the four policies (team SELECT, client SELECT,
-- write for workspace writers) and nothing else.
--
-- Existing objects this migration relies on (verified live via the
-- Supabase MCP against project qcipqonnqajmazdbysow immediately before
-- writing this file, not from memory):
--   * `page_components` table, `page_components.project_id` column, RLS
--     already enabled with no policies
--     (20261121010000_f002_page_components.sql).
--   * `public.is_project_visible_to(target_project_id uuid)` — last
--     (re)defined in 20260908010000_pin_pg_temp_on_client_visibility_predicates.sql;
--     confirmed live this is still the current definition (no later
--     migration redefines it). `security definer`, `stable`,
--     `set search_path = public, pg_temp`.
--   * `public.is_project_client(target_project_id uuid)` — last
--     (re)defined in the same 20260908010000 migration; confirmed live
--     as the current definition. True only when the caller's
--     `workspace_members.role` for that project's workspace is `client`.
--   * `public.is_project_portal_enabled(target_project_id uuid)` —
--     defined in 20260909010000_portal_foundations.sql; confirmed live
--     as the current (only) definition. True only when
--     `projects.portal_enabled` is true for that project.
--   * `public.is_project_workspace_writer(target_project_id uuid)` —
--     last (re)defined in 20261120010000_rls_initplan_wrap_auth_uid.sql
--     (which only re-wrapped `auth.uid()` per that migration's own
--     purpose; the role logic itself was last substantively changed in
--     20261025010000_security_audit_authz_holes.sql / restored from
--     20260908010000). Confirmed live as the current definition. Its
--     body is:
--       wm.role not in ('viewer', 'guest', 'client')
--       or (wm.role = 'guest' and exists (... project_members ...))
--     i.e. it EXCLUDES `viewer`, `client`, and a `guest` not explicitly
--     added to the project via `project_members` — exactly the predicate
--     AS-093 (client) and AS-097 (viewer) need. No new predicate was
--     invented; this existing function already does the right thing.
--
-- Policy shape follows the exact convention documented in
-- 20261106010000_scope_documents.sql's header and used by
-- 20261101020000_f113_page_links.sql's team/client SELECT pair: the
-- client SELECT policy carries ALL FOUR conjuncts — membership
-- (`is_project_visible_to`), ROLE (`is_project_client`), and
-- `is_project_portal_enabled` — never membership alone. The team SELECT
-- policy is `is_project_visible_to(project_id) and not
-- is_project_client(project_id)`, the same shape every project-scoped
-- team table in this schema uses (e.g. `page_links_select_team`,
-- `project_scope_documents` team policy).
--
-- Unlike `page_links` (keyed on `task_id`, requiring a join through
-- `tasks` to reach `project_id`), `page_components.project_id` is a
-- direct column, so no join is needed in any policy here.
--
-- Standing decision 6 (clarifications/standing-decisions.md): "Client
-- sees the board read-only ... only when the project's portal is
-- enabled." Standing decisions "Both" #18-20: no new package/service/env
-- var; live schema read via Supabase MCP before writing; SQL committed
-- as a file in addition to being applied.
--
-- Per the feature spec: clients never write components (AS-093) —
-- INSERT/UPDATE/DELETE are gated on `is_project_workspace_writer` only,
-- with no separate client-write policy at all (there is nothing to
-- union with — a client never satisfies workspace-writer).

alter table page_components enable row level security;

drop policy if exists page_components_select_team on page_components;
create policy page_components_select_team
  on page_components
  for select
  to authenticated
  using (
    public.is_project_visible_to(page_components.project_id)
    and not public.is_project_client(page_components.project_id)
  );

drop policy if exists page_components_select_client on page_components;
create policy page_components_select_client
  on page_components
  for select
  to authenticated
  using (
    public.is_project_visible_to(page_components.project_id)
    and public.is_project_client(page_components.project_id)
    and public.is_project_portal_enabled(page_components.project_id)
  );

drop policy if exists page_components_insert_team on page_components;
create policy page_components_insert_team
  on page_components
  for insert
  to authenticated
  with check (
    public.is_project_workspace_writer(page_components.project_id)
  );

drop policy if exists page_components_update_team on page_components;
create policy page_components_update_team
  on page_components
  for update
  to authenticated
  using (
    public.is_project_workspace_writer(page_components.project_id)
  )
  with check (
    public.is_project_workspace_writer(page_components.project_id)
  );

drop policy if exists page_components_delete_team on page_components;
create policy page_components_delete_team
  on page_components
  for delete
  to authenticated
  using (
    public.is_project_workspace_writer(page_components.project_id)
  );
