-- Fix for a regression introduced by 20260821140526_project_visibility_rls_sweep.sql
-- (found during orchestrator verification of F132; AS-028, F025's projects
-- INSERT test): after that migration, an authenticated member could no
-- longer INSERT a project when the client asked for the row back via
-- `.select()` (PostgREST's INSERT ... RETURNING), even though the same
-- INSERT without RETURNING succeeded and the row was fully visible via a
-- separate SELECT immediately afterward.
--
-- Root cause: PostgreSQL evaluates a table's SELECT RLS policies against
-- the RETURNING row of an INSERT within the *same command*. A row this
-- INSERT just produced has not yet had CommandCounterIncrement() called,
-- so it is invisible to any ordinary table scan issued from within that
-- same command — including a scan inside a SECURITY DEFINER helper
-- function. `public.is_project_visible_to(target_project_id)` does exactly
-- that: it re-queries `projects` by id ("from projects p ... where p.id =
-- target_project_id") to look up the row's own workspace_id/visibility.
-- For every *other* caller of is_project_visible_to (tasks, comments,
-- attachments, time_entries, checklist_items, task_dependencies — all
-- resolve through project_id/task_id pointing at an already-committed row
-- in a *different* table) this lookup is fine. It only breaks when the
-- table being written to (projects) is the same table the helper
-- self-queries, which is exclusively projects_select_active_members.
--
-- Fix: give the projects SELECT policy the row's own workspace_id and
-- visibility directly from RLS's row context (no self re-query needed —
-- USING clauses already evaluate per-row with the row's columns in scope)
-- via a new overload, instead of re-deriving them from a lookup by id.
-- is_project_visible_to(uuid) itself is untouched and keeps working
-- everywhere else it's used (tasks/is_task_visible_to, and any future
-- ad-hoc "is this project visible to me" check by id where the row is
-- already committed).

create or replace function public.is_project_visible_to_row(
  target_project_id uuid,
  target_workspace_id uuid,
  target_visibility text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        target_visibility = 'workspace'
        or wm.role in ('owner', 'admin')
        or exists (
          select 1
          from project_members pm
          where pm.project_id = target_project_id
            and pm.user_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.is_project_visible_to_row(uuid, uuid, text) from public;
grant execute on function public.is_project_visible_to_row(uuid, uuid, text) to authenticated, anon;

drop policy if exists projects_select_active_members on projects;
create policy projects_select_active_members
  on projects
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_project_visible_to_row(id, workspace_id, visibility)
  );
