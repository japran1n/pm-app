-- F006b (missions/20260903-portal, M1 remediation): fold `portal_enabled`
-- into the `client_requests` SELECT/INSERT policies (AS-007).
--
-- 20260909010000 folded `is_project_portal_enabled()` into
-- `tasks_select_active_members` and `is_task_visible_to`, but
-- `client_requests` (20260902030000) predates `portal_enabled` entirely
-- and was never revisited: a client could still file a request against,
-- and read their own past requests against, a project whose portal is
-- off. `getPortalRequests` (lib/queries/portal.ts) is a second, belt-and-
-- braces filter on the same fact -- this migration is the actual gate, so
-- a direct PostgREST call is closed too, not only the app's own query.
--
-- Both changes are additive AND-conjuncts: nothing a portal-enabled
-- project's client could already do is narrowed further, and the team
-- branches (is_project_workspace_writer / `not is_project_client`) are
-- untouched -- `is_project_portal_enabled` only has teeth inside the
-- client half of each predicate, exactly as
-- `tasks_select_active_members`'s own comment describes.

-- ---------------------------------------------------------------------
-- SELECT: the author's own branch now also requires the project's own
-- portal to be on. The team branch (not is_project_client) is unchanged.
-- ---------------------------------------------------------------------

drop policy if exists client_requests_select_author_or_team on public.client_requests;
create policy client_requests_select_author_or_team
  on public.client_requests
  for select
  to authenticated
  using (
    (
      created_by = auth.uid()
      and public.is_project_portal_enabled(project_id)
    )
    or (
      public.is_project_visible_to(project_id)
      and not public.is_project_client(project_id)
    )
  );

-- ---------------------------------------------------------------------
-- INSERT: a client cannot file a request against a portal-disabled
-- project, even though `is_project_visible_to`/`is_project_client` would
-- otherwise allow it (portal_enabled has no bearing on ordinary project
-- membership -- same distinction `is_project_portal_enabled`'s own
-- doc comment in 20260909010000 draws).
-- ---------------------------------------------------------------------

drop policy if exists client_requests_insert_own on public.client_requests;
create policy client_requests_insert_own
  on public.client_requests
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
    and status = 'submitted'
    and converted_task_id is null
    and reviewed_by is null
  );
