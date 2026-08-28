-- Fix: docs and doc_folders RLS policies did not check project visibility
-- for project-scoped records. A workspace member who is NOT a member of a
-- private project could read/write that project's docs. Updated policies
-- require is_project_visible_to(project_id) for project-scoped rows
-- (project_id IS NOT NULL), matching the precedent set by channels and
-- project_statuses RLS policies.

-- doc_folders

drop policy if exists doc_folders_select_active_members on doc_folders;
create policy doc_folders_select_active_members
  on doc_folders
  for select
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists doc_folders_insert_active_members on doc_folders;
create policy doc_folders_insert_active_members
  on doc_folders
  for insert
  to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists doc_folders_update_active_members on doc_folders;
create policy doc_folders_update_active_members
  on doc_folders
  for update
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists doc_folders_delete_active_members on doc_folders;
create policy doc_folders_delete_active_members
  on doc_folders
  for delete
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

-- docs

drop policy if exists docs_select_active_members on docs;
create policy docs_select_active_members
  on docs
  for select
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists docs_insert_active_members on docs;
create policy docs_insert_active_members
  on docs
  for insert
  to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists docs_update_active_members on docs;
create policy docs_update_active_members
  on docs
  for update
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );

drop policy if exists docs_delete_active_members on docs;
create policy docs_delete_active_members
  on docs
  for delete
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      project_id is null
      or public.is_project_visible_to(project_id)
    )
  );
