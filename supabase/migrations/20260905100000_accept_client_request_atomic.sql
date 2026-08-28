-- W7e (missions/20260828-hardening/w7-atomicity-triage.md, Tier 2): closes
-- the hand-rolled compensation gap in `acceptClientRequest`
-- (lib/actions/client-requests.ts).
--
-- Before this migration, acceptClientRequest inserted a `tasks` row, then
-- updated the originating `client_requests` row to point at it; if that
-- update failed it issued a *compensating* delete of the task it had just
-- created. That delete was itself an unguarded network write -- if it also
-- failed, the result is an orphan task on the board with no request link,
-- indistinguishable from any other task, that the client cannot see the
-- origin of and the team cannot easily find to clean up.
--
-- Fix: move the task insert and the client_requests update into a single
-- SECURITY DEFINER function, mirroring create_channel_atomic
-- (20260905090000) and create_workspace_with_owner
-- (20260817234323_workspace_create_rpc.sql). A function body runs inside
-- one implicit transaction, so if the update fails, Postgres rolls back the
-- task insert too.
--
-- Runs as the calling user (auth.uid()), same as create_workspace_with_owner
-- -- it must be invoked through a client carrying that user's session, not
-- the admin/service client. The Server Action has already re-verified the
-- caller's membership and triage permission (AS-143 convention) before
-- calling this function; the function itself re-checks the request exists,
-- is not already accepted, and locks the row (`for update`) before deciding,
-- so two concurrent accepts of the same request cannot both succeed.
create or replace function public.accept_client_request_atomic(
  p_request_id uuid
)
returns table (task_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_title text;
  v_body text;
  v_desired_by date;
  v_status text;
  v_task_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select project_id, title, body, desired_by, status
    into v_project_id, v_title, v_body, v_desired_by, v_status
    from client_requests
   where id = p_request_id
     for update;

  if v_project_id is null then
    raise exception 'request not found';
  end if;

  if v_status = 'accepted' then
    raise exception 'request already accepted';
  end if;

  insert into tasks (project_id, title, description, status, author_id, due_date, client_visible)
  values (v_project_id, v_title, v_body, 'todo', v_user_id, v_desired_by, true)
  returning id into v_task_id;

  update client_requests
     set status = 'accepted',
         decline_reason = null,
         converted_task_id = v_task_id,
         reviewed_by = v_user_id,
         reviewed_at = now()
   where id = p_request_id;

  return query select v_task_id;
end;
$$;

revoke all on function public.accept_client_request_atomic(uuid) from public;
grant execute on function public.accept_client_request_atomic(uuid) to authenticated;
