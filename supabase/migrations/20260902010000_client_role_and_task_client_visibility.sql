-- C1 + C2 (docs/client-portal-plan.md): the `client` workspace role, and
-- per-task client visibility.
--
-- A client is an external party (the customer a project is being delivered
-- for), not a member of the team. They get their own portal UI and may see
-- only the tasks the team has explicitly shared with them.
--
-- The whole enforcement rests on two existing helper functions rather than
-- on new per-table policies: every SELECT policy in this schema routes
-- through `is_project_visible_to()` and every write routes through
-- `is_project_workspace_writer()` / `is_task_workspace_writer()`. Extending
-- those three (plus one new task-level predicate) covers tasks, comments,
-- checklists, time entries, attachments, activity and statuses at once, and
-- keeps a single place where visibility is decided. Adding parallel
-- client-specific policies per table would guarantee drift.

-- ---------------------------------------------------------------------
-- 1. The role itself
-- ---------------------------------------------------------------------
-- Same pattern as 20260821184932_workspace_members_role_expansion.sql.

alter table workspace_members drop constraint if exists workspace_members_role_check;

alter table workspace_members
  add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'member', 'viewer', 'guest', 'client'));

-- ---------------------------------------------------------------------
-- 2. Per-task client visibility
-- ---------------------------------------------------------------------
-- Default false: nothing becomes visible to a client retroactively when
-- this migration runs. Sharing is always an explicit act by the team.

alter table tasks
  add column if not exists client_visible boolean not null default false;

-- The portal's main read is "the shared tasks of one project", so index the
-- pair, restricted to shared rows (a partial index stays small because the
-- overwhelming majority of tasks are never shared).
create index if not exists tasks_project_id_client_visible_idx
  on tasks (project_id)
  where client_visible;

-- ---------------------------------------------------------------------
-- 3. Is the caller a client of this project's workspace?
-- ---------------------------------------------------------------------
-- SECURITY DEFINER + stable, matching every other predicate in this schema
-- (a client cannot read `workspace_members` itself, so this must not depend
-- on that table's own RLS).

create or replace function public.is_project_client(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role = 'client'
  );
$$;

-- ---------------------------------------------------------------------
-- 4. Project visibility: a client sees only projects they were added to
-- ---------------------------------------------------------------------
-- Identical treatment to `guest`: the "everyone in the workspace sees
-- workspace-visible projects" branch is closed off, leaving only the
-- explicit `project_members` branch. Without this a client would see every
-- non-private project in the workspace, including other clients' work.

create or replace function public.is_project_visible_to(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        (
          wm.role not in ('guest', 'client')
          and (
            p.visibility = 'workspace'
            or wm.role in ('owner', 'admin')
          )
        )
        or exists (
          select 1
          from project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
      )
  );
$$;

-- ---------------------------------------------------------------------
-- 5. Writes: a client is read-only everywhere these gates are used
-- ---------------------------------------------------------------------
-- `client_requests` (C5) is the one thing a client may write, and it will
-- carry its own policies rather than going through these predicates.
-- Commenting on shared tasks (C7) will likewise widen this deliberately,
-- not by accident.

create or replace function public.is_project_workspace_writer(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role not in ('viewer', 'client')
  );
$$;

create or replace function public.is_task_workspace_writer(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role not in ('viewer', 'client')
  );
$$;

-- ---------------------------------------------------------------------
-- 6. Task SELECT: a client sees only shared tasks, and never the trash
-- ---------------------------------------------------------------------
-- Note the shape of the added clause: `client_visible OR NOT
-- is_project_client(...)`. For everyone on the team the second half is
-- true, so the row filter is exactly what it was before this migration —
-- no behaviour change and no extra function call cost on the common path,
-- because Postgres short-circuits the OR once `client_visible` is true.

drop policy if exists tasks_select_active_members on tasks;
create policy tasks_select_active_members
  on tasks
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_project_visible_to(project_id)
    and (client_visible or not public.is_project_client(project_id))
  );

-- Deleted tasks are an internal concern; a client has no trash view at all.
drop policy if exists tasks_select_trash_visible_members on tasks;
create policy tasks_select_trash_visible_members
  on tasks
  for select
  to authenticated
  using (
    deleted_at is not null
    and public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

-- ---------------------------------------------------------------------
-- 7. Comments follow their task
-- ---------------------------------------------------------------------
-- `is_task_visible_to` delegates to `is_project_visible_to`, which is
-- project-level and therefore blind to `client_visible`. Without this, a
-- client added to a project could read comments on tasks they cannot see.

create or replace function public.is_task_visible_to(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from tasks t
    where t.id = target_task_id
      and public.is_project_visible_to(t.project_id)
      and (t.client_visible or not public.is_project_client(t.project_id))
  );
$$;
