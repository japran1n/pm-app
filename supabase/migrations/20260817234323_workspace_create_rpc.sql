-- F095 (follow-up to F013/F012, AS-006): close the orphan-workspace path
-- found by scrutiny (M2-scrutiny.md AS-006, "follow-up-workspace-insert-rls-
-- hardening").
--
-- Bug: `workspaces_insert_authenticated` (`with check (true)`) let *any*
-- authenticated caller INSERT a `workspaces` row directly via the Supabase
-- client, bypassing `createWorkspace` entirely. Because `workspace_members`
-- has no INSERT policy for `authenticated`, a workspace created that way can
-- never get an owner row — it's permanently orphaned and squats its slug
-- forever. Separately, `createWorkspace`'s own compensating-rollback delete
-- (workspace insert succeeds, membership insert fails, so it manually
-- deletes the workspace) had an untested path where the rollback delete
-- itself could also fail, silently leaving the same kind of orphan.
--
-- Fix: move workspace creation fully behind a SECURITY DEFINER function that
-- performs the workspace INSERT and the owner-membership INSERT in a single
-- function call. A single SQL/PLpgSQL function body executes inside one
-- implicit transaction — if the second insert raises, Postgres rolls back
-- the entire function invocation, including the first insert. That gives
-- atomicity "for free" with no manual compensating action and no window
-- where a workspace can exist without its owner row.
--
-- To make the RPC the *only* path (not just the recommended one), the old
-- permissive `with check (true)` INSERT policy is dropped and the
-- `authenticated` role's table-level INSERT grant on `workspaces` is
-- revoked. In Postgres, RLS policies are only ever consulted after the
-- role's base table-level privilege check passes — revoking INSERT means a
-- bare `authenticated`-role client-side `.from("workspaces").insert(...)`
-- is rejected with a permission error before any policy even runs, closing
-- the bypass regardless of what any current or future INSERT policy says.
-- The SECURITY DEFINER function below still works because it executes with
-- the privileges of its owner (the migration-running role), not the
-- caller's grants.

-- ---------------------------------------------------------------------------
-- create_workspace_with_owner: atomically insert a workspace row and its
-- creator's owner-membership row. Runs as the calling user (auth.uid()),
-- so it must be invoked through a client carrying that user's session (the
-- publishable-key client with an active session), not the admin/service
-- client — the function itself sources the owner's user id from auth.uid(),
-- not from an argument, so a caller cannot make someone else the owner.
-- ---------------------------------------------------------------------------
create or replace function public.create_workspace_with_owner(
  p_name text,
  p_slug text
)
returns table (id uuid, slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into workspaces (name, slug)
  values (p_name, p_slug)
  returning workspaces.id into v_workspace_id;

  insert into workspace_members (workspace_id, user_id, role, status)
  values (v_workspace_id, v_user_id, 'owner', 'active');

  return query select v_workspace_id, p_slug;
end;
$$;

revoke all on function public.create_workspace_with_owner(text, text) from public;
grant execute on function public.create_workspace_with_owner(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Close the direct-insert bypass on workspaces.
-- ---------------------------------------------------------------------------

drop policy if exists workspaces_insert_authenticated on workspaces;

revoke insert on workspaces from authenticated;

-- No replacement INSERT policy is created: workspace creation now only ever
-- happens inside create_workspace_with_owner, which runs as the function
-- owner (elevated privileges) and therefore does not need — and is not
-- subject to — the caller's own table grants or RLS policies on the
-- INSERT it performs internally. Admin/service-role writes (e.g. test
-- fixtures seeding a workspace directly via the secret-key client) are
-- unaffected: the secret key connects as a role that bypasses RLS and
-- table grants by design (see lib/supabase/admin.ts), not as `authenticated`.
