-- Custom fields per project: lets a PM define flexible, project-scoped
-- extra fields on tasks (e.g. "Client number", "Figma frame link") beyond
-- the fixed status/priority/type/phase set. Two tables, mirroring
-- `project_statuses`' (20260824010000_project_statuses.sql) project-scoped
-- shape for the definitions, and `page_links`'
-- (20261101020000_f113_page_links.sql) task-scoped read/write split for
-- the per-task values:
--
--   - `project_custom_fields`: one row per field DEFINITION, owned by a
--     project. `field_type` is a small fixed vocabulary (text/number/url/
--     checkbox) the UI switches its input control on.
--   - `task_custom_field_values`: one row per (task, field) VALUE, stored
--     as `text` regardless of `field_type` (same "store as text, cast at
--     the edges" convention this codebase already uses for
--     `tasks.estimate_minutes`' human input in
--     lib/time/parse-estimate.ts) -- avoids a value column per type and
--     keeps the value write path a single upsert regardless of which
--     field_type it targets. `unique (task_id, field_id)` is the PK, so a
--     re-save of the same field on the same task is an upsert, never a
--     duplicate row.
--
-- RLS: read is gated on project visibility (`is_project_visible_to`),
-- write is gated on `is_project_workspace_writer` -- the same
-- viewer-reads/writer-writes split `page_links` already uses, deliberately
-- narrower than `project_statuses`' plain-visibility write gate (custom
-- field DEFINITIONS are a project setup action, closer in spirit to
-- "who can manage this project's structure" than "who can drag a card").
-- The app layer additionally gates field-definition management (create/
-- delete) behind `canManageColumns` (lib/auth/permissions.ts), the same
-- project-lead-or-above predicate `lib/actions/statuses.ts` already uses
-- for board columns -- the closest existing analogue to "manage this
-- project's field structure" this codebase has. Per-task VALUE writes
-- (`setTaskCustomFieldValue`) use the broader `canEditTask`/write gate
-- instead, matching the rest of a task's own editable fields.

create table if not exists project_custom_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  field_type text not null check (field_type in ('text', 'number', 'url', 'checkbox')),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  constraint project_custom_fields_name_not_empty check (btrim(name) <> ''),
  constraint project_custom_fields_name_length check (char_length(name) <= 100)
);

create unique index if not exists project_custom_fields_project_id_name_idx
  on project_custom_fields (project_id, name);

create index if not exists project_custom_fields_project_id_position_idx
  on project_custom_fields (project_id, position);

alter table project_custom_fields enable row level security;

drop policy if exists project_custom_fields_select_visible on project_custom_fields;
create policy project_custom_fields_select_visible
  on project_custom_fields
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
  );

drop policy if exists project_custom_fields_insert_writer on project_custom_fields;
create policy project_custom_fields_insert_writer
  on project_custom_fields
  for insert
  to authenticated
  with check (
    public.is_project_workspace_writer(project_id)
  );

drop policy if exists project_custom_fields_update_writer on project_custom_fields;
create policy project_custom_fields_update_writer
  on project_custom_fields
  for update
  to authenticated
  using (
    public.is_project_workspace_writer(project_id)
  )
  with check (
    public.is_project_workspace_writer(project_id)
  );

drop policy if exists project_custom_fields_delete_writer on project_custom_fields;
create policy project_custom_fields_delete_writer
  on project_custom_fields
  for delete
  to authenticated
  using (
    public.is_project_workspace_writer(project_id)
  );

-- ---------------------------------------------------------------------
-- task_custom_field_values -- one row per (task, field) value.
-- ---------------------------------------------------------------------

create table if not exists task_custom_field_values (
  task_id uuid not null references tasks (id) on delete cascade,
  field_id uuid not null references project_custom_fields (id) on delete cascade,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_custom_field_values_pkey primary key (task_id, field_id),
  constraint task_custom_field_values_value_length check (value is null or char_length(value) <= 2000)
);

create index if not exists task_custom_field_values_field_id_idx
  on task_custom_field_values (field_id);

drop trigger if exists task_custom_field_values_set_updated_at on task_custom_field_values;
create trigger task_custom_field_values_set_updated_at
  before update on task_custom_field_values
  for each row
  execute function set_updated_at();

alter table task_custom_field_values enable row level security;

drop policy if exists task_custom_field_values_select_visible on task_custom_field_values;
create policy task_custom_field_values_select_visible
  on task_custom_field_values
  for select
  to authenticated
  using (
    exists (
      select 1
      from tasks t
      where t.id = task_custom_field_values.task_id
        and public.is_project_visible_to(t.project_id)
    )
  );

drop policy if exists task_custom_field_values_insert_writer on task_custom_field_values;
create policy task_custom_field_values_insert_writer
  on task_custom_field_values
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from tasks t
      where t.id = task_custom_field_values.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  );

drop policy if exists task_custom_field_values_update_writer on task_custom_field_values;
create policy task_custom_field_values_update_writer
  on task_custom_field_values
  for update
  to authenticated
  using (
    exists (
      select 1
      from tasks t
      where t.id = task_custom_field_values.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  )
  with check (
    exists (
      select 1
      from tasks t
      where t.id = task_custom_field_values.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  );

drop policy if exists task_custom_field_values_delete_writer on task_custom_field_values;
create policy task_custom_field_values_delete_writer
  on task_custom_field_values
  for delete
  to authenticated
  using (
    exists (
      select 1
      from tasks t
      where t.id = task_custom_field_values.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  );
