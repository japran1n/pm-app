-- F020 fix-up: scrutiny-2.md Part 2, BLOCKER-1 and BLOCKER-3.
--
-- BLOCKER-1: `approve_portal_task_atomic` (20260905130000) authorizes on
-- workspace-level `role = 'client'` membership ONLY. But
-- `is_project_visible_to()` (20260902010000) makes an explicit
-- `project_members` row the only way a `client` can see a project --
-- F012's own E2E fix had to seed one for exactly this reason
-- (tests/e2e/portal-approve.spec.ts). Because the function is SECURITY
-- DEFINER, RLS never runs and this check is the *entire* boundary: a
-- client with access to project A could flip `pending_client_approval` on
-- a client-visible pending task in project B of the same workspace, a
-- task they cannot even read through the app.
--
-- Fix: reuse `is_project_visible_to()` -- the same predicate every SELECT
-- policy in this schema already uses -- rather than hand-rolling a second
-- definition of project visibility here.
--
-- BLOCKER-3: `requestPortalTaskChanges` (lib/actions/portal-approval.ts)
-- still issues a plain RLS-respecting UPDATE, which
-- `tasks_update_active_members` (20260821194500) can never satisfy for a
-- `client` role (`is_project_workspace_writer()` explicitly excludes
-- `client`, 20260902010000). PostgREST returns 0 rows and no error, so the
-- action logs the request comment and reports success while the approval
-- flag never clears. Fix: give it the same narrow SECURITY DEFINER path as
-- `approve_portal_task_atomic`, sharing one authorization routine so the
-- two client actions cannot drift apart again.
--
-- Both RPCs below delegate their authorization check to a single new
-- helper, `assert_portal_task_actionable_by_client`, instead of repeating
-- the workspace-membership + project-visibility + client_visible/pending
-- logic twice. It raises the same uniform 'task not found' exception used
-- everywhere in this file, so no oracle is introduced by adding the extra
-- check.

create or replace function public.assert_portal_task_actionable_by_client(
  p_task_id uuid
)
returns table (task_id uuid, project_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
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

  -- BLOCKER-1 fix: a `client` only ever sees a project through an explicit
  -- `project_members` row (is_project_visible_to's client branch). Without
  -- this, workspace-level client membership alone let a client act on any
  -- client-visible task in the workspace, including projects they cannot
  -- read.
  if not public.is_project_visible_to(v_project_id) then
    raise exception 'task not found';
  end if;

  if not v_client_visible or not v_pending then
    raise exception 'task not found';
  end if;

  return query select p_task_id, v_project_id;
end;
$$;

revoke all on function public.assert_portal_task_actionable_by_client(uuid) from public;
-- No direct grant: this is an internal helper called only from the two RPCs
-- below, both of which are SECURITY DEFINER themselves, so `authenticated`
-- does not need EXECUTE on it directly.

create or replace function public.approve_portal_task_atomic(
  p_task_id uuid
)
returns table (task_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform * from public.assert_portal_task_actionable_by_client(p_task_id);

  update tasks
     set pending_client_approval = false
   where id = p_task_id;

  return query select p_task_id;
end;
$$;

revoke all on function public.approve_portal_task_atomic(uuid) from public;
grant execute on function public.approve_portal_task_atomic(uuid) to authenticated;

-- BLOCKER-3: sibling RPC for "request changes", on identical authorization
-- terms (same caller re-verification, same project-visibility check) as
-- approve. A separate function rather than an `action` parameter on the
-- existing one, so each keeps a single, obviously-correct write statement
-- and neither can be invoked with the other's semantics by accident.
create or replace function public.request_portal_task_changes_atomic(
  p_task_id uuid
)
returns table (task_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform * from public.assert_portal_task_actionable_by_client(p_task_id);

  update tasks
     set pending_client_approval = false
   where id = p_task_id;

  return query select p_task_id;
end;
$$;

revoke all on function public.request_portal_task_changes_atomic(uuid) from public;
grant execute on function public.request_portal_task_changes_atomic(uuid) to authenticated;
