-- F132: project visibility RLS sweep (AS-226, AS-227, AS-228, AS-229).
--
-- Introduces two SECURITY DEFINER helpers:
--   public.is_project_visible_to(project_id)  — the new visibility-aware
--     replacement for public.is_project_workspace_member: true when the
--     caller is an active workspace member AND (the project is
--     'workspace'-visible, OR the caller is a workspace owner/admin, OR the
--     caller has an explicit project_members row for this project).
--   public.is_task_visible_to(task_id) — the task-level equivalent,
--     resolving the task's project and delegating to
--     is_project_visible_to. Replaces public.is_task_workspace_member in
--     every policy this migration touches.
--
-- Scope, per this feature's spec:
--   - mission-1 tables (projects, tasks, comments, attachments,
--     time_entries): SELECT policies only.
--   - M13-created tables that scoped RLS through the old
--     tasks -> projects -> workspace_members pattern instead of this new
--     function (checklist_items, task_dependencies): every policy on those
--     tables (SELECT, INSERT, UPDATE, DELETE) is swept, not just SELECT —
--     per this feature's "Added scope" note, since a private project's
--     data must not be writable by a workspace-only member either.
--
-- (task_assignees, task_watchers, task_templates are also named in the
-- Added scope note, but F159/F163/F181 — the features that create those
-- tables — have not run yet as of this migration; there is nothing to
-- sweep for them yet. See this feature's handoff "Out-of-scope work
-- needed" for a follow-up note to whoever finishes those features.)
--
-- AS-229 (only owners/admins may change a project's visibility) is
-- enforced by a BEFORE UPDATE trigger below, not by RLS alone: RLS's
-- USING/WITH CHECK apply to the whole row, not a single column, and
-- projects_update_active_members intentionally still allows any active
-- member to edit a project's other fields (AS-029). The trigger fires only
-- when the incoming visibility value differs from the stored one.

create or replace function public.is_project_visible_to(target_project_id uuid)
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
      and (
        p.visibility = 'workspace'
        or wm.role in ('owner', 'admin')
        or exists (
          select 1
          from project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.is_project_visible_to(uuid) from public;
grant execute on function public.is_project_visible_to(uuid) to authenticated, anon;

create or replace function public.is_task_visible_to(target_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from tasks t
    where t.id = target_task_id
      and public.is_project_visible_to(t.project_id)
  );
$$;

revoke all on function public.is_task_visible_to(uuid) from public;
grant execute on function public.is_task_visible_to(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------
-- projects (AS-226, AS-227, AS-228)
-- ---------------------------------------------------------------------

drop policy if exists projects_select_active_members on projects;
create policy projects_select_active_members
  on projects
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_project_visible_to(id)
  );

-- ---------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------

drop policy if exists tasks_select_active_members on tasks;
create policy tasks_select_active_members
  on tasks
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_project_visible_to(project_id)
  );

-- ---------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------

drop policy if exists comments_select_active_members on comments;
create policy comments_select_active_members
  on comments
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_task_visible_to(task_id)
  );

-- ---------------------------------------------------------------------
-- attachments (table + storage.objects)
-- ---------------------------------------------------------------------

drop policy if exists attachments_select_active_members on attachments;
create policy attachments_select_active_members
  on attachments
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  );

drop policy if exists attachments_objects_select_active_members on storage.objects;
create policy attachments_objects_select_active_members
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and exists (
      select 1
      from attachments a
      where a.file_url = storage.objects.name
        and public.is_task_visible_to(a.task_id)
    )
  );

-- ---------------------------------------------------------------------
-- time_entries
-- ---------------------------------------------------------------------

drop policy if exists time_entries_select_active_members on time_entries;
create policy time_entries_select_active_members
  on time_entries
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  );

-- ---------------------------------------------------------------------
-- checklist_items (M13, F151/F152) — full sweep, not just SELECT
-- ---------------------------------------------------------------------

drop policy if exists checklist_items_select_active_members on checklist_items;
create policy checklist_items_select_active_members
  on checklist_items
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  );

drop policy if exists checklist_items_insert_active_members on checklist_items;
create policy checklist_items_insert_active_members
  on checklist_items
  for insert
  to authenticated
  with check (
    public.is_task_visible_to(task_id)
  );

drop policy if exists checklist_items_update_active_members on checklist_items;
create policy checklist_items_update_active_members
  on checklist_items
  for update
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  )
  with check (
    public.is_task_visible_to(task_id)
  );

drop policy if exists checklist_items_delete_active_members on checklist_items;
create policy checklist_items_delete_active_members
  on checklist_items
  for delete
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  );

-- ---------------------------------------------------------------------
-- task_dependencies (M13, F155/F156) — full sweep, not just SELECT
-- ---------------------------------------------------------------------

drop policy if exists task_dependencies_select_active_members on task_dependencies;
create policy task_dependencies_select_active_members
  on task_dependencies
  for select
  to authenticated
  using (
    public.is_task_visible_to(blocking_task_id)
  );

drop policy if exists task_dependencies_insert_active_members on task_dependencies;
create policy task_dependencies_insert_active_members
  on task_dependencies
  for insert
  to authenticated
  with check (
    public.is_task_visible_to(blocking_task_id)
    and public.is_task_visible_to(blocked_task_id)
  );

drop policy if exists task_dependencies_delete_active_members on task_dependencies;
create policy task_dependencies_delete_active_members
  on task_dependencies
  for delete
  to authenticated
  using (
    public.is_task_visible_to(blocking_task_id)
  );

-- ---------------------------------------------------------------------
-- AS-229: only workspace owners/admins may change a project's visibility
-- ---------------------------------------------------------------------

create or replace function public.enforce_project_visibility_change_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role (the admin client, used only for read-only lookups and
  -- test/seed fixtures per this codebase's convention — see
  -- lib/supabase/admin.ts) bypasses RLS by design; this trigger only
  -- gates the authenticated-user write path.
  if new.visibility is distinct from old.visibility and auth.role() <> 'service_role' then
    if not exists (
      select 1
      from workspace_members wm
      where wm.workspace_id = new.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    ) then
      raise exception 'Only workspace owners or admins can change a project''s visibility'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_enforce_visibility_change_role on projects;
create trigger projects_enforce_visibility_change_role
  before update on projects
  for each row
  execute function public.enforce_project_visibility_change_role();
