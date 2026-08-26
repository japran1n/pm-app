-- F428-F430 (docs/plan-daily-work-followups.md): status templates.
--
-- Every project's board columns start from the SAME hardcoded four-status
-- shape (seed_default_project_statuses, 20260824010000_project_statuses.sql)
-- with no way for a team to define its own starting point — a Webflow
-- agency's "Setup / Content / Design / Dev / QA / Launch" workflow has no
-- home except manually rebuilding it, column by column, on every new
-- project.
--
-- A template is a named, ORDERED list of (name, color, category) rows a
-- workspace owns. Applying a template to a project copies that list into
-- the project's own `project_statuses` — templates are a stamping
-- mechanism, not a live link, matching this codebase's existing
-- `task_templates` precedent (F181/F184: a template is copied at apply
-- time, never referenced afterward). This is deliberate: a project's
-- columns must keep working even if the template that seeded them is later
-- edited or deleted.

create table if not exists status_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint status_templates_name_not_empty check (btrim(name) <> '')
);

create unique index if not exists status_templates_workspace_id_name_idx
  on status_templates (workspace_id, name);
create index if not exists status_templates_workspace_id_idx
  on status_templates (workspace_id);

create table if not exists status_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references status_templates (id) on delete cascade,
  name text not null,
  color text not null,
  category text not null check (category in ('not_started', 'in_progress', 'done')),
  position double precision not null default 0,
  constraint status_template_items_name_not_empty check (btrim(name) <> '')
);

create index if not exists status_template_items_template_id_idx
  on status_template_items (template_id);
create index if not exists status_template_items_template_id_position_idx
  on status_template_items (template_id, position);

-- ---------------------------------------------------------------------
-- RLS: read = any active workspace member (same visibility class as
-- task_templates); write = owner/admin only, re-checked server-side by
-- every Server Action in lib/actions/status-templates.ts on top of this.
-- ---------------------------------------------------------------------

alter table status_templates enable row level security;
alter table status_template_items enable row level security;

drop policy if exists status_templates_select_active_members on status_templates;
create policy status_templates_select_active_members
  on status_templates
  for select
  to authenticated
  using (public.is_active_workspace_member(workspace_id));

drop policy if exists status_templates_write_admins on status_templates;
create policy status_templates_write_admins
  on status_templates
  for all
  to authenticated
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = status_templates.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = status_templates.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  );

drop policy if exists status_template_items_select_active_members on status_template_items;
create policy status_template_items_select_active_members
  on status_template_items
  for select
  to authenticated
  using (
    exists (
      select 1 from status_templates st
      where st.id = status_template_items.template_id
        and public.is_active_workspace_member(st.workspace_id)
    )
  );

drop policy if exists status_template_items_write_admins on status_template_items;
create policy status_template_items_write_admins
  on status_template_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from status_templates st
      join workspace_members wm on wm.workspace_id = st.workspace_id
      where st.id = status_template_items.template_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1
      from status_templates st
      join workspace_members wm on wm.workspace_id = st.workspace_id
      where st.id = status_template_items.template_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------
-- apply_status_template: replace a project's board columns with a
-- template's items, in ONE transaction, never dropping a task.
--
-- Safety, in order:
--   1. Every existing task whose current status NAME matches a template
--      item's name keeps that exact row (no reassignment, no status_id
--      churn) — applying a template that happens to share column names
--      with the current board is a no-op for those columns' tasks.
--   2. Every task on a column NOT present in the new template is
--      reassigned to the first new-template column matching its OLD
--      column's category (not_started -> not_started, etc.), so a task
--      that was "in progress" stays conceptually "in progress" even
--      though its literal column disappeared. Same reassign-before-delete
--      shape reassign_and_delete_project_status already uses
--      (20260824040000), just applied to N columns in one pass instead of
--      one column at a time.
--   3. Old columns with no surviving task references are deleted;
--      template items not already present are inserted.
--
-- `security definer` because a caller's own role has already been
-- verified by the RLS policies above (this function only runs after the
-- caller could already read/write status_templates for this workspace);
-- SET search_path pinned per this schema's existing convention.
-- ---------------------------------------------------------------------

create or replace function public.apply_status_template(
  p_project_id uuid,
  p_template_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_template_workspace_id uuid;
  v_caller_role text;
  v_old_status record;
  v_new_status_id uuid;
  v_next_position double precision;
begin
  select workspace_id into v_workspace_id from projects where id = p_project_id;
  if v_workspace_id is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  -- security definer bypasses RLS entirely once inside this function —
  -- the two policies above only gate whether a plain SELECT/INSERT/UPDATE
  -- on status_templates/status_template_items succeeds, they say nothing
  -- about a direct RPC call to THIS function. Re-check the caller's role
  -- explicitly, the same "security definer + revoke public + re-verify
  -- membership inside the function body" shape every other privileged RPC
  -- in this schema uses (e.g. reassign_and_delete_project_status). Without
  -- this, `grant execute ... to authenticated` below would let ANY
  -- signed-in user — including a non-member of this workspace — replace
  -- any project's columns by calling the RPC directly, RLS or no RLS.
  select wm.role into v_caller_role
  from workspace_members wm
  where wm.workspace_id = v_workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'active';

  if v_caller_role is null or v_caller_role not in ('owner', 'admin') then
    raise exception 'Only a workspace owner or admin may apply a status template.'
      using errcode = '42501';
  end if;

  select workspace_id into v_template_workspace_id
  from status_templates where id = p_template_id;
  if v_template_workspace_id is null then
    raise exception 'Template not found.' using errcode = 'P0002';
  end if;
  if v_template_workspace_id <> v_workspace_id then
    raise exception 'Template must belong to the project''s workspace.'
      using errcode = '22023';
  end if;

  -- Insert every template item not already present by name, so a
  -- same-named column is reused rather than duplicated.
  select coalesce(max(position), 0) into v_next_position
  from project_statuses where project_id = p_project_id;

  insert into project_statuses (project_id, name, color, category, position)
  select
    p_project_id,
    sti.name,
    sti.color,
    sti.category,
    v_next_position + sti.position
  from status_template_items sti
  where sti.template_id = p_template_id
    and not exists (
      select 1 from project_statuses ps
      where ps.project_id = p_project_id and ps.name = sti.name
    )
  order by sti.position;

  -- Reassign tasks off any column that is NOT one of the template's names,
  -- to the first surviving column (template item, or a same-named
  -- pre-existing column) sharing that old column's category.
  for v_old_status in
    select ps.id, ps.category
    from project_statuses ps
    where ps.project_id = p_project_id
      and ps.name not in (
        select sti.name from status_template_items sti
        where sti.template_id = p_template_id
      )
  loop
    select ps2.id into v_new_status_id
    from project_statuses ps2
    where ps2.project_id = p_project_id
      and ps2.category = v_old_status.category
      and ps2.name in (
        select sti.name from status_template_items sti
        where sti.template_id = p_template_id
      )
    order by ps2.position
    limit 1;

    -- No same-category survivor (e.g. the template has no "done" column
    -- at all): fall back to ANY surviving template column, so a task is
    -- never left pointing at a status_id about to be deleted.
    if v_new_status_id is null then
      select ps2.id into v_new_status_id
      from project_statuses ps2
      where ps2.project_id = p_project_id
        and ps2.name in (
          select sti.name from status_template_items sti
          where sti.template_id = p_template_id
        )
      order by ps2.position
      limit 1;
    end if;

    update tasks
    set status_id = v_new_status_id,
        status = (select name from project_statuses where id = v_new_status_id)
    where status_id = v_old_status.id;

    delete from project_statuses where id = v_old_status.id;
  end loop;
end;
$$;

revoke all on function public.apply_status_template(uuid, uuid) from public;
grant execute on function public.apply_status_template(uuid, uuid) to authenticated;
