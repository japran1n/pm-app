-- F326: M16 scrutiny blockers B4 (AS-414) and B5 (AS-434) — two RLS holes
-- that let a direct PostgREST call (browser client, publishable key)
-- bypass application-layer authorization entirely.
--
-- B4 — project_statuses INSERT/UPDATE/DELETE gated on
-- `is_project_visible_to` alone, which is true for viewers and guests.
-- Role was checked ONLY in lib/actions/statuses.ts's
-- `authorizeColumnManagement` (-> `canManageColumns`), never at the DB
-- layer, so a viewer/guest with devtools open can mutate another team's
-- board columns directly.
--
-- Fix: recreate the three write policies to ALSO require the caller be a
-- workspace owner/admin of the project's workspace. Reuses (never
-- duplicates) the existing `public.is_workspace_admin(workspace_id)`
-- helper (supabase/migrations/20260817222822_rls_workspaces.sql) — the
-- same "owner/admin" role predicate `enforce_project_visibility_change_
-- role` and the `workspace_logo`/`audit_log`/`task_templates` admin
-- policies all already reuse. A NEW composing helper,
-- `is_project_workspace_admin(project_id)`, only joins `projects` to
-- resolve the project's `workspace_id` and then delegates the actual role
-- check to `is_workspace_admin` — it does not re-implement the
-- `role in ('owner','admin')` predicate itself.
--
-- Scope note: `canManageColumns` in application code also allows a
-- project LEAD (a `project_members.project_role = 'lead'` row) who is not
-- a workspace owner/admin. This migration intentionally does NOT extend
-- the DB-level predicate to cover project leads (AUTONOMOUS_DECISION,
-- see this feature's handoff) — every real write path
-- (lib/actions/statuses.ts, the `reassign_and_delete_project_status` RPC,
-- the seed trigger, the F325 rename-sync trigger) writes through
-- `createAdminClient()` or is itself `security definer`, both of which
-- bypass RLS entirely, so a project lead's Server Action writes are
-- UNAFFECTED by this tightening. Only the direct-RLS-scoped browser path
-- — which never had project-lead nuance to begin with, since it wasn't
-- checking role at all — is narrowed, and narrowed to the safe floor the
-- spec asked for. The Server Action's own `canManageColumns` call remains
-- the place a project lead's edit is authorized; RLS is defense in depth,
-- not the sole gate, exactly as instructed.
--
-- B5 — saved_views UPDATE policy checked only `owner_id = auth.uid()`,
-- unlike INSERT's policy which additionally requires visibility into the
-- target `workspace_id`/`project_id`. An owner could therefore PATCH
-- their own row's `workspace_id`/`project_id`/`scope` to relocate a
-- shared view into a workspace they cannot see, making it appear (with an
-- attacker-controlled name and link) to every member of that foreign
-- workspace.
--
-- Fix: mirror the INSERT policy's `with check` visibility clause onto
-- UPDATE's `with check`, so a row can only be *left* in (or moved to) a
-- workspace/project the caller can already see — the same rule INSERT
-- already enforces for where a row may be *created*.

-- ---------------------------------------------------------------------
-- B4: project_statuses write policies gain a workspace-admin requirement
-- ---------------------------------------------------------------------

create or replace function public.is_project_workspace_admin(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from projects p
    where p.id = target_project_id
      and public.is_workspace_admin(p.workspace_id)
  );
$$;

revoke all on function public.is_project_workspace_admin(uuid) from public;
grant execute on function public.is_project_workspace_admin(uuid) to authenticated, anon;

drop policy if exists project_statuses_insert_visible on project_statuses;
create policy project_statuses_insert_admin
  on project_statuses
  for insert
  to authenticated
  with check (
    public.is_project_visible_to(project_id)
    and public.is_project_workspace_admin(project_id)
  );

drop policy if exists project_statuses_update_visible on project_statuses;
create policy project_statuses_update_admin
  on project_statuses
  for update
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and public.is_project_workspace_admin(project_id)
  )
  with check (
    public.is_project_visible_to(project_id)
    and public.is_project_workspace_admin(project_id)
  );

drop policy if exists project_statuses_delete_visible on project_statuses;
create policy project_statuses_delete_admin
  on project_statuses
  for delete
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and public.is_project_workspace_admin(project_id)
  );

-- project_statuses_select_visible (visibility-only) is UNCHANGED: reading
-- board columns is not the hole here, and every role including
-- viewer/guest must still be able to read them to render the board.

-- ---------------------------------------------------------------------
-- B5: saved_views UPDATE mirrors INSERT's visibility WITH CHECK
-- ---------------------------------------------------------------------

drop policy if exists saved_views_update_own on public.saved_views;
create policy saved_views_update_own
  on public.saved_views
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (
      (project_id is not null and public.is_project_visible_to(project_id))
      or (project_id is null and public.is_active_workspace_member(workspace_id))
    )
  );

-- DELETE is unaffected: a delete needs no visibility check on the
-- resulting row (there is no resulting row), so `owner_id = auth.uid()`
-- alone remains correct and is left as-is.
