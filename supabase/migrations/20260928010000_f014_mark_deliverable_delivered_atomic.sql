-- F014 (missions/20260903-portal, AS-030): the client-side half of the
-- deliverable lifecycle F013 started. F013 built
-- `accept_deliverable_atomic` (team-only, via `is_project_workspace_writer`,
-- which explicitly excludes `client` — 20260927010000's own header
-- comment) for the accept/return decision. This migration adds the one
-- state transition a CLIENT is allowed to make: uploading a file marks a
-- deliverable `delivered`, never `accepted`.
--
-- This function takes no state/decision parameter at all — it hardcodes
-- the single UPDATE it is allowed to perform. That is the actual
-- enforcement of AS-030/AS-032's "a client cannot set a deliverable to
-- accepted through any path": there is no argument on this RPC a client
-- could pass to reach 'accepted', unlike accept_deliverable_atomic, whose
-- own p_decision enum is exactly why THAT function needs a role check
-- instead.
--
-- Authorization follows accept_client_request_atomic's own shape
-- (20260921010000): re-select the caller's real workspace role from
-- workspace_members (this function is SECURITY DEFINER and bypasses RLS
-- as its owner, so nothing else enforces this), then gate on
-- `is_project_visible_to` (the same predicate every client SELECT policy
-- in this schema already uses — a client with no project_members row for
-- a 'private' project can act on it) and `is_project_portal_enabled` (the
-- same portal gate every other client write path in this mission applies
-- — F006i/F006l/F016's own accept_client_request_atomic).
--
-- Deliberately allows ANY active member the project is visible to, not
-- only the `client` role: a team member previewing/using the portal (or
-- uploading on a client's behalf) hits the exact same "this is a delivery,
-- not an acceptance" rule — there is no separate, laxer path for a team
-- caller to accidentally reach 'accepted' through this function, because
-- this function still never accepts one.
create or replace function public.mark_deliverable_delivered_atomic(
  p_deliverable_id uuid
)
returns table (deliverable_id uuid, state text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_visibility text;
  v_state text;
begin
  if v_user_id is null then
    raise exception 'mark_deliverable_delivered_atomic: not authenticated' using errcode = '28000';
  end if;

  select cd.project_id, cd.state, p.visibility
    into v_project_id, v_state, v_visibility
    from client_deliverables cd
    join projects p on p.id = cd.project_id
   where cd.id = p_deliverable_id
     for update of cd;

  if v_project_id is null then
    raise exception 'mark_deliverable_delivered_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if not public.is_project_visible_to(v_project_id) then
    raise exception 'mark_deliverable_delivered_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if not public.is_project_portal_enabled(v_project_id) then
    raise exception 'mark_deliverable_delivered_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if v_state in ('accepted', 'waived') then
    raise exception 'mark_deliverable_delivered_atomic: this item has already been accepted' using errcode = '42501';
  end if;

  update client_deliverables
     set state = 'delivered',
         delivered_at = now(),
         review_note = null
   where id = p_deliverable_id;

  return query select p_deliverable_id, 'delivered'::text;
end;
$$;

revoke all on function public.mark_deliverable_delivered_atomic(uuid) from public;
grant execute on function public.mark_deliverable_delivered_atomic(uuid) to authenticated;
