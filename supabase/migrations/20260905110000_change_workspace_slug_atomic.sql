-- W7e (missions/20260828-hardening/w7-atomicity-triage.md, Tier 2): closes
-- the hand-rolled compensation gap in `changeWorkspaceSlug`
-- (lib/actions/workspaces.ts).
--
-- Before this migration, changeWorkspaceSlug inserted a
-- `workspace_slug_history` row recording the old slug, then updated
-- `workspaces.slug` to the new value; if that update failed it issued a
-- *compensating* delete of the history row it had just inserted. That
-- delete was itself an unguarded network write -- if it also failed, the
-- result is a phantom history row claiming a slug was retired when the
-- workspace never actually stopped using it, permanently blocking that slug
-- (via AS-242's history-collision check) from ever being claimed by anyone,
-- including the workspace it still belongs to.
--
-- Fix: move the history insert and the workspaces update into a single
-- SECURITY DEFINER function, mirroring create_channel_atomic (20260905090000)
-- and accept_client_request_atomic (20260905100000). A function body runs
-- inside one implicit transaction, so if the workspaces update fails,
-- Postgres rolls back the history insert too.
--
-- All of this function's own uniqueness/collision checks (AS-242) and the
-- caller's owner/admin permission check happen in the Server Action before
-- this RPC is called, same "second line of defense" split every other
-- action in this file uses -- this function itself just re-validates the
-- workspace still exists and is not deleted, then performs both writes
-- together, locking the workspace row first so a concurrent slug change on
-- the same workspace can't interleave with this one.
create or replace function public.change_workspace_slug_atomic(
  p_workspace_id uuid,
  p_old_slug text,
  p_new_slug text
)
returns table (slug text)
language plpgsql
security definer
set search_path = public
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

revoke all on function public.change_workspace_slug_atomic(uuid, text, text) from public;
grant execute on function public.change_workspace_slug_atomic(uuid, text, text) to authenticated, service_role;
