-- FU-S (scrutiny-3, MAJOR-4): pin `pg_temp` on the SECURITY DEFINER
-- predicates that `20260902010000_client_role_and_task_client_visibility.sql`
-- introduced, and that F020's portal RPCs (`20260906010000_...sql`) now rely
-- on as an authorization boundary.
--
-- `set search_path = public` (no `pg_temp`) lets Postgres implicitly search
-- pg_temp first, since it is not explicitly listed. A role with TEMP
-- privileges on the database (the Supabase default for `authenticated`)
-- could create pg_temp.projects / pg_temp.project_members /
-- pg_temp.workspace_members and shadow the real tables inside these
-- SECURITY DEFINER bodies. Pinning `public, pg_temp` closes that off, same
-- pattern already used by `20260906010000_portal_task_actions_project_visibility.sql`.
--
-- Hardening only: body, signature, volatility and grants are byte-identical
-- to the live definitions (verified via the Management API against the
-- linked project before writing this file). `CREATE OR REPLACE FUNCTION`
-- preserves existing grants, so none are re-declared here. Safe to re-run.

create or replace function public.is_project_client(target_project_id uuid)
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
      and wm.role = 'client'
  );
$$;

create or replace function public.is_project_visible_to(target_project_id uuid)
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
      and wm.role not in ('viewer', 'client')
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
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role not in ('viewer', 'client')
  );
$$;

create or replace function public.is_task_visible_to(target_task_id uuid)
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
      and public.is_project_visible_to(t.project_id)
      and (t.client_visible or not public.is_project_client(t.project_id))
  );
$$;
