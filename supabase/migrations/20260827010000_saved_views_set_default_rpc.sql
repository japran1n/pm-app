-- F228: atomically make a saved view the caller's default for its
-- (owner_id, project_id) pair (AS-431), without ever exposing the
-- underlying `saved_views_owner_default_per_project_idx` partial unique
-- index (F227) to the app layer as a raw 23505 conflict. Two UPDATE
-- statements (clear the old default, then set the new one) must never be
-- separable -- a crash between them would leave a project with either
-- zero or, worse, briefly two defaults visible to a concurrent reader --
-- so this is one PL/pgSQL function executed inside a single implicit
-- transaction, the same idiom as reassign_and_delete_project_status
-- (20260824040000_status_delete_reassign_rpc.sql).
--
-- SECURITY DEFINER, granted only to service_role and called from
-- lib/actions/views.ts's setDefaultSavedView AFTER that action has
-- already re-verified the caller is really the view's owner_id (the only
-- caller for whom "the user's default" is meaningful, since is_default is
-- scoped per owner_id, not per viewer) -- this function trusts its caller
-- exactly like reassign_and_delete_project_status trusts statuses.ts.
create or replace function public.set_saved_view_default(p_view_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_project_id uuid;
begin
  select owner_id, project_id into v_owner_id, v_project_id
  from saved_views
  where id = p_view_id
  for update;

  if v_owner_id is null then
    raise exception 'View not found.'
      using errcode = 'P0002';
  end if;

  -- Clear any existing default for this (owner, project) pair FIRST, so
  -- the second statement below never collides with the partial unique
  -- index -- both statements run in the same implicit transaction, so a
  -- crash between them cannot leave two defaults set, only (at worst,
  -- impossible under normal execution) zero, which the app layer treats
  -- identically to "no default chosen yet".
  update saved_views
  set is_default = false
  where owner_id = v_owner_id
    and project_id is not distinct from v_project_id
    and id <> p_view_id
    and is_default;

  update saved_views
  set is_default = true
  where id = p_view_id
    and is_default = false;
end;
$$;

revoke all on function public.set_saved_view_default(uuid) from public;
grant execute on function public.set_saved_view_default(uuid) to service_role;
