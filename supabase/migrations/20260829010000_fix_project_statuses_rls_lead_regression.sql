-- F327: fixes a regression introduced by F326's migration
-- (20260828040000_rls_hardening_project_statuses_and_saved_views.sql).
--
-- CORRECTION to that migration's own header: it justified excluding
-- project leads from the `project_statuses` write-RLS predicate by
-- claiming "every real write path goes through createAdminClient()".
-- That claim is FALSE. `lib/actions/statuses.ts`'s `addColumn` (~line
-- 226), `updateColumn` (~308) and `reorderColumn` (~404) all perform
-- their actual insert/update via the request-scoped, RLS-respecting
-- client (`supabase`, from lib/supabase/server.ts), not the admin client
-- — only `removeColumnWithReassignment`'s underlying RPC
-- (`reassign_and_delete_project_status`) is `security definer` and
-- genuinely bypasses RLS. So F326's `project_statuses_insert_admin`/
-- `_update_admin`/`_delete_admin` policies (owner/admin-only) silently
-- rejected every add/rename/reorder/plain-delete performed by a project
-- LEAD — a role `canManageColumns` (lib/auth/permissions.ts:69-73) and
-- the columns settings page both explicitly allow. A project lead saw
-- the controls enabled, submitted, and got a generic "Something went
-- wrong" because the DB silently rejected the write underneath the
-- app-layer authorization that had already approved it.
--
-- Fix: replace `is_project_workspace_admin` in the three write policies
-- with `public.is_project_lead_or_workspace_admin`, which ALREADY EXISTS
-- (supabase/migrations/20260821140520_project_members.sql) and already
-- expresses exactly the rule `canManageColumns` encodes in application
-- code: workspace owner/admin, OR an existing project lead
-- (`project_members.project_role = 'lead'`). No new predicate is written
-- here — this migration only swaps which existing helper the policies
-- call. `is_project_lead_or_workspace_admin` already has the same
-- SECURITY DEFINER / `set search_path = public` / narrow-grant
-- (`authenticated, anon` only) shape F326 required of
-- `is_project_workspace_admin`, and is already used by
-- `project_members`'s own insert/delete policies for the identical rule,
-- so this migration composes from what's there rather than duplicating
-- anything.
--
-- Viewers/guests remain refused (F326's real fix, AS-414, is preserved):
-- `is_project_lead_or_workspace_admin` still requires either an
-- owner/admin workspace role or an explicit `project_role = 'lead'` row —
-- a viewer, guest, or a plain (non-lead) member matches neither branch.
--
-- `is_project_workspace_admin` (F326's helper) is left in place, unused
-- by these three policies now, rather than dropped: dropping it is not
-- required to fix this bug and a stray "was this fully migrated away"
-- audit is out of this feature's scope; nothing else references it.

drop policy if exists project_statuses_insert_admin on project_statuses;
create policy project_statuses_insert_admin
  on project_statuses
  for insert
  to authenticated
  with check (
    public.is_project_visible_to(project_id)
    and public.is_project_lead_or_workspace_admin(project_id)
  );

drop policy if exists project_statuses_update_admin on project_statuses;
create policy project_statuses_update_admin
  on project_statuses
  for update
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and public.is_project_lead_or_workspace_admin(project_id)
  )
  with check (
    public.is_project_visible_to(project_id)
    and public.is_project_lead_or_workspace_admin(project_id)
  );

drop policy if exists project_statuses_delete_admin on project_statuses;
create policy project_statuses_delete_admin
  on project_statuses
  for delete
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and public.is_project_lead_or_workspace_admin(project_id)
  );

-- project_statuses_select_visible (visibility-only, unchanged by F326)
-- remains unchanged here too: reads were never the problem.
