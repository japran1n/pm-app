-- F128 fix-forward: 20260821194500_viewer_guest_write_rls.sql's writer
-- helpers (is_project_workspace_writer, is_task_workspace_writer,
-- can_modify_comment) excluded both 'viewer' AND 'guest' from writing.
-- That over-broadened F128's scope (which is the viewer role specifically
-- — see this feature's spec title "viewer role is read-only everywhere")
-- and regressed F134's already-established AS-223 ("a guest can comment
-- on and be assigned tasks inside a project they were added to"):
-- tests/integration/rls-guest.test.ts's AS-223 case started failing
-- (`new row violates row-level security policy for table "comments"`)
-- after that migration landed.
--
-- Fix: `create or replace function` with the exact same signature/name
-- keeps every policy that already calls these functions wired up — no
-- policy needs to be redefined — dropping the `'guest'` branch from the
-- `wm.role not in (...)` exclusion so guest write behaviour returns to
-- exactly what it was before 20260821194500 (governed by its own,
-- unrelated rules — F134's project-membership scoping on reads, no
-- additional write restriction from this feature). Only 'viewer' remains
-- excluded, matching lib/auth/permissions.ts's `canWrite` predicate after
-- the same fix.

create or replace function public.is_project_workspace_writer(target_project_id uuid)
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
      and wm.role <> 'viewer'
  );
$$;

create or replace function public.is_task_workspace_writer(target_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role <> 'viewer'
  );
$$;

create or replace function public.can_modify_comment(target_comment_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from comments c
    join tasks t on t.id = c.task_id
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where c.id = target_comment_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role <> 'viewer'
      and (
        c.user_id = auth.uid()
        or wm.role in ('owner', 'admin')
      )
  );
$$;
