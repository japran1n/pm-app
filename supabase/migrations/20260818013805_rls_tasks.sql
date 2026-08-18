-- F034: RLS for tasks (AS-062)
--
-- Convention (tech-decisions.md): every workspace-scoped table's policies
-- join through workspace_members on auth.uid() — no table trusts a
-- workspace_id (or, here, project_id) value passed from the client without
-- checking membership.
--
-- tasks is one join level deeper than projects: tasks -> projects ->
-- workspace_members (project_id has no workspace_id column of its own).
-- Rather than repeating a two-level join inline in every policy, this adds
-- a SECURITY DEFINER helper `public.is_project_workspace_member`, mirroring
-- the shape of F012's `public.is_active_workspace_member` (reused as-is by
-- F025 for projects) but specific to the tasks->projects->workspace chain.

create or replace function public.is_project_workspace_member(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

revoke all on function public.is_project_workspace_member(uuid) from public;
grant execute on function public.is_project_workspace_member(uuid) to authenticated, anon;

alter table tasks enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as F012/F025 — the app never
-- connects as the table owner for reads; privileged server-side access goes
-- through the secret key, which bypasses RLS by design and is never exposed
-- to the client.

-- SELECT: any active member of the workspace that owns the task's project,
-- excluding soft-deleted rows (AS-062, soft-delete convention).
create policy tasks_select_active_members
  on tasks
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_project_workspace_member(project_id)
  );

-- INSERT: any active member of the target project's workspace may create a
-- task. with check re-validates project_id on the incoming row so a member
-- of workspace A cannot insert a task claiming a project_id that belongs to
-- workspace B.
create policy tasks_insert_active_members
  on tasks
  for insert
  to authenticated
  with check (
    public.is_project_workspace_member(project_id)
  );

-- UPDATE: any active member of the task's project's workspace may edit it
-- (AS-061 — no per-task ownership restriction beyond workspace membership).
-- with check re-validates on the post-update row so a member cannot use an
-- update to move a task into a project outside their workspace.
create policy tasks_update_active_members
  on tasks
  for update
  to authenticated
  using (
    deleted_at is null
    and public.is_project_workspace_member(project_id)
  )
  with check (
    public.is_project_workspace_member(project_id)
  );

-- No DELETE policy: tasks use soft-delete only (deleted_at), per
-- tech-decisions.md's soft-delete convention. Absence of a DELETE policy
-- denies hard DELETE by default under RLS for both authenticated and anon
-- roles, which is the safe baseline. A future admin purge feature can add a
-- narrowly-scoped DELETE policy then rather than this feature speculatively
-- adding one now.

-- No policy is created for anon or for authenticated non-members: absence of
-- a matching policy means those rows are simply not returned/writable (RLS
-- default deny), which is what AS-062 requires (filtered, not errored).
