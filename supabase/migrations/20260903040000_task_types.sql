-- F434-F440 (docs/plan-daily-work-followups.md, docs/must-have-webflow-agency.md
-- "Add-on" naming analysis): customizable task types — a workspace-owned
-- taxonomy (Setup, Content, Design, Dev, SEO, QA, Add-on, ...) a team
-- defines for itself, quick-filterable on the List view.
--
-- Deliberately its own table, not a generic custom-fields system: this
-- mirrors project_statuses/status_templates exactly (name + colour +
-- position, workspace-owned, owner/admin managed) rather than building a
-- general-purpose field framework for one field. "Add-on" (from this
-- project's earlier billable-vs-add-on naming research) is seeded as one
-- example value here, not a rename of time_entries.billable — the two are
-- orthogonal: "Add-on" describes SCOPE (extra work beyond a retainer),
-- "billable" describes whether time is chargeable at all.

create table if not exists task_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  color text not null,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  constraint task_types_name_not_empty check (btrim(name) <> '')
);

create unique index if not exists task_types_workspace_id_name_idx
  on task_types (workspace_id, name);
create index if not exists task_types_workspace_id_idx
  on task_types (workspace_id);
create index if not exists task_types_workspace_id_position_idx
  on task_types (workspace_id, position);

alter table tasks add column if not exists task_type_id uuid references task_types (id) on delete set null;
create index if not exists tasks_task_type_id_idx on tasks (task_type_id);

alter table task_types enable row level security;

drop policy if exists task_types_select_active_members on task_types;
create policy task_types_select_active_members
  on task_types
  for select
  to authenticated
  using (public.is_active_workspace_member(workspace_id));

drop policy if exists task_types_write_admins on task_types;
create policy task_types_write_admins
  on task_types
  for all
  to authenticated
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = task_types.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = task_types.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  );
