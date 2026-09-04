-- Security audit (2026-09-04): five authorization holes, three reachable
-- by any signed-in user through plain PostgREST with the public anon key.
-- Fixes are grouped here as one migration since all five are urgent and
-- none touches the other's tables/functions.
--
-- For each hole, the choice between (a) adding a caller-authorization
-- check inside the function body and (b) revoking the external grant is
-- made deliberately per function, following the same "revoke all, then
-- grant back only what is needed" convention this schema already uses
-- (e.g. 20261004010000_f016g_default_acl_and_unguarded_functions.sql) and
-- the `if auth.uid() is not null then ... end if` caller-check idiom that
-- migration's own `purge_task` fix and
-- 20260921010000_f006n_unguarded_task_rpcs.sql use for functions that
-- legitimately need both a service-role call path (auth.uid() is null)
-- and a direct-authenticated-caller path.

-- ---------------------------------------------------------------------
-- Hole 1: transfer_workspace_ownership — SECURITY DEFINER, no caller
-- authorization at all. Verified: lib/actions/workspaces.ts's
-- transferOwnership() already re-checks the caller is the active owner
-- via requireWorkspaceOwner() BEFORE issuing this RPC, and issues the RPC
-- through createAdminClient() (service-role key, lib/supabase/admin.ts) —
-- auth.uid() is null on that call path. No other caller exists (grep:
-- only lib/actions/workspaces.ts references this RPC name). The
-- `authenticated` grant therefore serves no legitimate app path and is
-- pure attack surface: a viewer/guest/client member could call it
-- directly via their own JWT with p_workspace_id/p_new_owner_user_id set
-- to their own ids, since the function itself never checks who is
-- calling. Fix: revoke the `authenticated` grant entirely (option b —
-- stronger than an in-body check, since a function nothing can call
-- cannot be called wrongly). `service_role` keeps its grant so
-- transferOwnership() keeps working unchanged.
-- ---------------------------------------------------------------------
revoke execute on function public.transfer_workspace_ownership(uuid, uuid) from authenticated;

-- ---------------------------------------------------------------------
-- Hole 2: remove_workspace_member — same shape as hole 1. Verified:
-- lib/actions/workspaces.ts's removeMember() re-checks the caller via
-- requireWorkspaceAdmin() first, then calls this RPC through
-- createAdminClient() (service-role). No other caller exists (grep). The
-- `authenticated` grant is pure attack surface, letting any signed-in
-- user delete an arbitrary member (down to the last admin) of any
-- workspace they can guess a membership id for. Fix: revoke the
-- `authenticated` grant entirely (option b), same reasoning as hole 1.
-- ---------------------------------------------------------------------
revoke execute on function public.remove_workspace_member(uuid, uuid) from authenticated;

-- ---------------------------------------------------------------------
-- Hole 3: change_workspace_slug_atomic — same shape again. Verified:
-- lib/actions/workspaces.ts's changeWorkspaceSlug() re-checks the caller
-- via requireWorkspaceAdmin() first, then calls this RPC through
-- createAdminClient() (service-role). No other caller exists (grep). Fix:
-- revoke the `authenticated` grant entirely (option b).
--
-- Also closes the search_path gap 20260914010000_f006d_authz_gaps.sql
-- noticed but didn't fix: `set search_path = public` (no `pg_temp`) is
-- pinned to `public, pg_temp` here, matching every other SECURITY DEFINER
-- function this schema fixed the same way since
-- 20260908010000_pin_pg_temp_on_client_visibility_predicates.sql. Doing
-- this via `create or replace function` (not just a grant/revoke)
-- preserves the identical body — only the `set search_path` line and the
-- resulting external grant differ from the live definition.
-- ---------------------------------------------------------------------
create or replace function public.change_workspace_slug_atomic(
  p_workspace_id uuid,
  p_old_slug text,
  p_new_slug text
)
returns table (slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_slug text;
  v_deleted_at timestamptz;
begin
  select workspaces.slug, workspaces.deleted_at
    into v_current_slug, v_deleted_at
    from workspaces
   where workspaces.id = p_workspace_id
     for update;

  if v_current_slug is null then
    raise exception 'workspace not found';
  end if;

  if v_deleted_at is not null then
    raise exception 'workspace not found';
  end if;

  if v_current_slug <> p_old_slug then
    raise exception 'workspace slug changed concurrently';
  end if;

  insert into workspace_slug_history (workspace_id, old_slug)
  values (p_workspace_id, p_old_slug);

  update workspaces
     set slug = p_new_slug
   where workspaces.id = p_workspace_id;

  return query select p_new_slug;
end;
$$;

revoke all on function public.change_workspace_slug_atomic(uuid, text, text) from public, anon, authenticated;
grant execute on function public.change_workspace_slug_atomic(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Hole 4: guest writes are workspace-wide, not project-scoped like guest
-- reads. 20260821194634_guest_project_scoped_writes.sql deliberately made
-- is_project_workspace_writer() true for a guest only when a matching
-- project_members row exists (mirroring is_project_visible_to's own
-- guest branch). 20260821195500_viewer_write_rls_exclude_guest_fix.sql
-- re-created the function as `wm.role <> 'viewer'`, dropping that branch,
-- and 20260902010000/20260908010000 both copied the reverted body
-- forward (most recently as `wm.role not in ('viewer', 'client')` in
-- 20260908010000_pin_pg_temp_on_client_visibility_predicates.sql, the
-- live definition). Read access (is_project_visible_to) still scopes a
-- guest to their own project_members row, so a guest added to Project A
-- can currently INSERT into Project B's tasks/comments/etc. and then
-- cannot read the row back.
--
-- Checked for later dependents on the wider (workspace-wide) guest-write
-- behaviour before restoring the scoped branch:
--   - tests/integration/rls-guest.test.ts (F134, AS-220..AS-223, AS-237)
--     only asserts the POSITIVE case "guest CAN write inside their own
--     added project" — no test anywhere asserts a guest can write outside
--     a project they were added to. Restoring the scoped branch does not
--     regress AS-223.
--   - grep for every `create or replace function
--     public.is_project_workspace_writer` / `is_task_workspace_writer`
--     confirms 20260908010000 is the last migration to (re)define these
--     names; nothing after it touches them.
-- Fix: restore the guest branch, scoped to project_members, alongside the
-- existing `client` exclusion this function gained since F134 originally
-- shipped (clients remain excluded entirely — this migration only
-- restores the guest scoping, it does not touch the client behaviour
-- 20260902010000 added).
-- ---------------------------------------------------------------------
create or replace function public.is_project_workspace_writer(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        wm.role not in ('viewer', 'guest', 'client')
        or (
          wm.role = 'guest'
          and exists (
            select 1
            from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
          )
        )
      )
  );
$$;

create or replace function public.is_task_workspace_writer(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from tasks t
    where t.id = target_task_id
      and public.is_project_workspace_writer(t.project_id)
  );
$$;

-- ---------------------------------------------------------------------
-- Hole 5: generate_unique_project_key — SECURITY DEFINER, bypasses
-- `projects` RLS, no caller check, callable without authentication
-- (`anon` grant), and an existence oracle (a distinct returned key like
-- `MKT2` vs the bare `MKT` reveals whether a same-named project already
-- exists in the target workspace) plus up to 9000 sequential index
-- probes per call. Verified: grep of lib/ and app/ finds no `.rpc(...)`
-- call site for this function anywhere — its only two callers are the
-- `assign_project_key()` BEFORE INSERT trigger and the one-time backfill
-- DO block, both in
-- supabase/migrations/20260819061129_project_keys_and_task_numbers.sql.
-- `assign_project_key()` is itself SECURITY DEFINER, so its internal call
-- to generate_unique_project_key() runs as the function owner regardless
-- of the inserting role's own grants — an external EXECUTE grant on
-- generate_unique_project_key was never required for the trigger path to
-- work. Fix: revoke the `anon` and `authenticated` grants entirely
-- (option b — no legitimate caller loses anything; the trigger and
-- backfill paths are untouched).
-- ---------------------------------------------------------------------
revoke execute on function public.generate_unique_project_key(uuid, text) from anon, authenticated;
