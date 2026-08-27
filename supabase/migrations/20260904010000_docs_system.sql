-- W1 (docs/docs-system-plan.md): docs system — nested folders and documents,
-- workspace- and optionally project-scoped, editable by any active
-- workspace member (mirrors the permissive collaborative-editing pattern
-- used elsewhere in this schema rather than an owner/admin-gated one).

create table if not exists doc_folders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id   uuid references projects (id) on delete cascade,
  parent_id    uuid references doc_folders (id) on delete cascade,
  name         text not null,
  position     double precision not null default 0,
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  constraint doc_folders_name_not_empty check (btrim(name) <> ''),
  constraint doc_folders_no_self_ref check (parent_id is null or parent_id <> id)
);

create table if not exists docs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id   uuid references projects (id) on delete cascade,
  folder_id    uuid references doc_folders (id) on delete set null,
  title        text not null default 'Untitled',
  content      text not null default '',
  position     double precision not null default 0,
  created_by   uuid not null references auth.users (id),
  updated_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint docs_title_not_empty check (btrim(title) <> '')
);

-- updated_at housekeeping, same pattern as personal_todos etc.
drop trigger if exists docs_set_updated_at on docs;
create trigger docs_set_updated_at
  before update on docs
  for each row
  execute function set_updated_at();

-- A folder's scope (workspace_id, project_id) must match its parent's scope.
-- This keeps the folder tree from crossing workspace/project boundaries —
-- e.g. a project-scoped folder can never be nested under a folder that
-- belongs to a different project or to no project at all.
create or replace function public.check_doc_folder_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_workspace_id uuid;
  parent_project_id uuid;
begin
  if new.parent_id is not null then
    select workspace_id, project_id
      into parent_workspace_id, parent_project_id
      from doc_folders
      where id = new.parent_id;

    if parent_workspace_id is distinct from new.workspace_id
       or parent_project_id is distinct from new.project_id then
      raise exception 'doc_folders: parent folder scope (workspace_id, project_id) must match child scope';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists doc_folders_check_scope on doc_folders;
create trigger doc_folders_check_scope
  before insert or update on doc_folders
  for each row
  execute function public.check_doc_folder_scope();

create index if not exists doc_folders_workspace_project_parent_idx
  on doc_folders (workspace_id, project_id, parent_id);
create index if not exists doc_folders_workspace_project_position_idx
  on doc_folders (workspace_id, project_id, position);

create index if not exists docs_workspace_project_folder_idx
  on docs (workspace_id, project_id, folder_id);
create index if not exists docs_workspace_project_position_idx
  on docs (workspace_id, project_id, position);

alter table doc_folders enable row level security;
alter table docs enable row level security;

drop policy if exists doc_folders_select_active_members on doc_folders;
create policy doc_folders_select_active_members
  on doc_folders
  for select
  to authenticated
  using (public.is_active_workspace_member(workspace_id));

drop policy if exists doc_folders_insert_active_members on doc_folders;
create policy doc_folders_insert_active_members
  on doc_folders
  for insert
  to authenticated
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists doc_folders_update_active_members on doc_folders;
create policy doc_folders_update_active_members
  on doc_folders
  for update
  to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists doc_folders_delete_active_members on doc_folders;
create policy doc_folders_delete_active_members
  on doc_folders
  for delete
  to authenticated
  using (public.is_active_workspace_member(workspace_id));

drop policy if exists docs_select_active_members on docs;
create policy docs_select_active_members
  on docs
  for select
  to authenticated
  using (public.is_active_workspace_member(workspace_id));

drop policy if exists docs_insert_active_members on docs;
create policy docs_insert_active_members
  on docs
  for insert
  to authenticated
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists docs_update_active_members on docs;
create policy docs_update_active_members
  on docs
  for update
  to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists docs_delete_active_members on docs;
create policy docs_delete_active_members
  on docs
  for delete
  to authenticated
  using (public.is_active_workspace_member(workspace_id));
