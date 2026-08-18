-- F025: RLS for projects (AS-028)
--
-- Convention (tech-decisions.md): every workspace-scoped table's policies
-- join through workspace_members on auth.uid() — no table trusts a
-- workspace_id value passed from the client without checking membership.
--
-- Reuses the F012 SECURITY DEFINER helper `public.is_active_workspace_member`
-- (defined in 20260817222822_rls_workspaces.sql) rather than reinventing an
-- inline EXISTS subquery, for consistency with the established pattern.

alter table projects enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as F012 — the app never
-- connects as the table owner for reads; privileged server-side access goes
-- through the secret key, which bypasses RLS by design and is never exposed
-- to the client.

-- SELECT: any active member of the project's workspace, excluding
-- soft-deleted rows (AS-027, AS-028, soft-delete convention).
create policy projects_select_active_members
  on projects
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_active_workspace_member(workspace_id)
  );

-- INSERT: any active member of the target workspace may create a project
-- (AS-025). with check re-validates workspace_id on the incoming row so a
-- member of workspace A cannot insert a project claiming workspace_id B.
create policy projects_insert_active_members
  on projects
  for insert
  to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
  );

-- UPDATE: any active member of the project's workspace may edit it
-- (AS-029 — name/description/start/end date editable by any member, not
-- just admins). with check re-validates on the post-update row so a member
-- cannot use an update to move a project into a workspace they don't belong
-- to.
create policy projects_update_active_members
  on projects
  for update
  to authenticated
  using (
    deleted_at is null
    and public.is_active_workspace_member(workspace_id)
  )
  with check (
    public.is_active_workspace_member(workspace_id)
  );

-- No DELETE policy: projects use soft-delete only (archive sets deleted_at,
-- per F029/AS-030 — "archived" via UPDATE, not a hard DELETE). Per
-- tech-decisions.md's soft-delete convention, the app never hard-deletes
-- project rows, so a DELETE policy is intentionally omitted; absence of a
-- policy means hard DELETE is denied by default under RLS for both
-- authenticated and anon roles, which is the safe baseline. If a future
-- feature needs an explicit hard-delete/purge path (e.g. an admin data
-- retention tool), it should add a narrowly-scoped DELETE policy then rather
-- than this feature speculatively adding one now.

-- No policy is created for anon or for authenticated non-members: absence of
-- a matching policy means those rows are simply not returned/writable
-- (RLS default deny), which is what AS-028 requires (filtered, not errored).
