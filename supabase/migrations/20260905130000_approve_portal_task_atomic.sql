-- F012: fixes a real defect uncovered by writing the first live E2E test
-- for the client portal's approve flow (tests/e2e/portal-approve.spec.ts,
-- AS-029/AS-030). `approvePortalTask` / `requestPortalTaskChanges`
-- (lib/actions/portal-approval.ts) both flip `tasks.pending_client_approval`
-- through the RLS-respecting per-request client, exactly as every other
-- mutating action in this codebase does -- but 20260902010000 redefined
-- `is_project_workspace_writer()` to explicitly exclude `role = 'client'`
-- ("5. Writes: a client is read-only everywhere these gates are used"),
-- and `tasks_update_active_members` (20260821194500) is the only UPDATE
-- policy on `tasks`. The result: a client's Approve/Request-changes click
-- always silently no-ops (Postgrest returns 0 rows updated, no error) --
-- the one write a client is supposed to be able to make was never actually
-- reachable.
--
-- Fix, mirroring `accept_client_request_atomic` (20260905100000) and
-- `create_channel_atomic` (20260905090000): a narrow SECURITY DEFINER RPC
-- that runs as the calling client (`auth.uid()`), re-verifies (a) the
-- caller is an active `client` member of the task's workspace and (b) the
-- task is `client_visible` and currently `pending_client_approval` before
-- flipping exactly that one column to false. Unlike a table-level RLS
-- UPDATE policy, this cannot be reused to write any other column on
-- `tasks` even if a client crafted their own Postgrest request -- the
-- function body is the entire write surface.
create or replace function public.approve_portal_task_atomic(
  p_task_id uuid
)
returns table (task_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_client_visible boolean;
  v_pending boolean;
  v_deleted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select t.project_id, p.workspace_id, t.client_visible, t.pending_client_approval, t.deleted_at
    into v_project_id, v_workspace_id, v_client_visible, v_pending, v_deleted_at
    from tasks t
    join projects p on p.id = t.project_id
   where t.id = p_task_id
     for update of t;

  if v_project_id is null or v_deleted_at is not null then
    raise exception 'task not found';
  end if;

  if not exists (
    select 1
      from workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = v_user_id
       and wm.status = 'active'
       and wm.role = 'client'
  ) then
    raise exception 'task not found';
  end if;

  if not v_client_visible or not v_pending then
    raise exception 'task not found';
  end if;

  update tasks
     set pending_client_approval = false
   where id = p_task_id;

  return query select p_task_id;
end;
$$;

revoke all on function public.approve_portal_task_atomic(uuid) from public;
grant execute on function public.approve_portal_task_atomic(uuid) to authenticated;
