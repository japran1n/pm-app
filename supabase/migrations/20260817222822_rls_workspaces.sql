-- F012: RLS for workspaces + workspace_members (AS-010, AS-011, AS-137, AS-138, AS-139)
--
-- Convention (tech-decisions.md): every workspace-scoped table's policies join
-- through workspace_members on auth.uid() — no table trusts a workspace_id
-- value passed from the client without checking membership.
--
-- workspace_members is self-referencing (its own SELECT policy needs to know
-- whether the caller is a member of the workspace a row belongs to, which
-- would naively mean workspace_members querying workspace_members inside its
-- own RLS policy -> infinite recursion / self-referential re-evaluation).
-- We avoid that with a SECURITY DEFINER helper function that runs with the
-- privileges of its owner and therefore bypasses RLS internally, breaking the
-- recursive policy evaluation while still being driven by auth.uid().

-- ---------------------------------------------------------------------------
-- Helper: is the current user an active member of the given workspace?
-- SECURITY DEFINER + a fixed search_path so the function body's unqualified
-- table reference cannot be hijacked by a malicious search_path, and so this
-- query bypasses RLS on workspace_members instead of re-triggering it.
-- ---------------------------------------------------------------------------
create or replace function public.is_active_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

revoke all on function public.is_active_workspace_member(uuid) from public;
grant execute on function public.is_active_workspace_member(uuid) to authenticated, anon;

-- Same shape, restricted to owner/admin roles — used by workspaces UPDATE/DELETE.
create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_workspace_admin(uuid) from public;
grant execute on function public.is_workspace_admin(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Enable RLS (AS-137: every workspace-scoped table has RLS enabled)
-- ---------------------------------------------------------------------------
alter table workspaces enable row level security;
alter table workspace_members enable row level security;

-- No FORCE ROW LEVEL SECURITY needed: these tables have no owner-bypass
-- concern here since the app never connects as the table owner for reads;
-- server-side privileged access goes through the secret key (bypasses RLS by
-- design) which is never exposed to the client (AS-140).

-- ---------------------------------------------------------------------------
-- workspaces policies
-- ---------------------------------------------------------------------------

-- SELECT: visible only to an active member of that workspace (AS-010, AS-011, AS-138, AS-139).
-- Also respects soft-delete convention (deleted_at IS NULL) per tech-decisions.md.
create policy workspaces_select_active_members
  on workspaces
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_active_workspace_member(id)
  );

-- INSERT: any authenticated user may create a workspace. RLS does not gate
-- workspace creation itself — F013's application logic makes the creator the
-- 'owner' immediately after the insert (via a subsequent workspace_members
-- insert in the same transaction/flow). Until that membership row exists,
-- the creator cannot SELECT/UPDATE/DELETE their own new workspace under the
-- membership-gated policies below; F013 must create the membership row right
-- after insert, in the same request, before returning to the client.
create policy workspaces_insert_authenticated
  on workspaces
  for insert
  to authenticated
  with check (true);

-- UPDATE: only active owner/admin members (baseline shape; F020/F021 own the
-- specific remove/delete-workspace business logic and may layer additional
-- checks — this policy is intentionally just the baseline RLS gate).
create policy workspaces_update_admins
  on workspaces
  for update
  to authenticated
  using (
    deleted_at is null
    and public.is_workspace_admin(id)
  )
  with check (
    public.is_workspace_admin(id)
  );

-- DELETE: only active owner/admin members (baseline shape; see note above).
create policy workspaces_delete_admins
  on workspaces
  for delete
  to authenticated
  using (
    public.is_workspace_admin(id)
  );

-- No policy is created for anon or for authenticated non-members: absence of
-- a matching policy means those rows are simply not returned (RLS default
-- deny), which is what AS-138/AS-139 require (filtered, not errored).

-- ---------------------------------------------------------------------------
-- workspace_members policies
-- ---------------------------------------------------------------------------

-- SELECT: a user can see workspace_members rows only for workspaces where
-- they themselves have an active membership row. Uses the SECURITY DEFINER
-- helper above instead of a self-join subquery to avoid RLS recursion on
-- workspace_members querying itself (AS-010, AS-011, AS-139).
create policy workspace_members_select_fellow_members
  on workspace_members
  for select
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
  );

-- No INSERT/UPDATE/DELETE policies for workspace_members in this feature:
-- membership mutation (invites, role changes, accept/remove) is owned by
-- later features (F013 creator-owner bootstrap, invite flow, F020/F021
-- remove/delete). Without an explicit policy, those operations are denied
-- by default under RLS for the anon/authenticated roles, which is the safe
-- baseline until those features add scoped policies. Server-side flows that
-- must write before a membership policy exists (e.g. F013 bootstrapping the
-- first owner row) use the secret-key server client, which bypasses RLS by
-- design and is never exposed to the browser (AS-140).
