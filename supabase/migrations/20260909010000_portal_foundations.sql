-- F001 (missions/20260903-portal, M1): portal foundations — phases, page
-- fields on tasks, the portal on/off switch on projects, and a
-- client-facing explanation column on project_statuses.
--
-- Four additive pieces feeding the rebuilt client portal:
--   1. `project_phases` — an ordered list of phases per project, each
--      with a client-facing name/description/state/dates (AS-008).
--   2. `tasks.phase_id` / `page_slug` / `page_order` — the columns a task
--      needs to sit inside a phase and render as a "page" in the Pages
--      view (F005). No constraint ties `page_slug`/`page_order` to
--      `task_type = 'page'` — a check that reads another table isn't
--      worth the trigger, per this feature's clarified spec.
--   3. `projects.target_launch_date` / `launch_confidence` /
--      `launch_note` / `portal_enabled` / `portal_enabled_at` — the
--      fields the portal header reads, plus the switch that gates the
--      whole portal.
--   4. `project_statuses.client_description` — the client-facing
--      explanation behind a status pill (AS-016; wired to UI in F004).
--
-- `portal_enabled` is the sharp edge here: it defaults FALSE, so no
-- existing project becomes client-visible the moment this migration
-- lands — the same "sharing is a deliberate act" reasoning
-- `tasks.client_visible` (20260902010000) and
-- `tasks.pending_client_approval` (20260903050000) already established.
-- Every client-visible table/policy touched below therefore folds the
-- project's `portal_enabled` into its own predicate (AS-007): a project
-- that already has shared tasks does NOT retroactively unlock its
-- portal just because this migration ran, because `portal_enabled` is
-- independent of `client_visible`.

-- ---------------------------------------------------------------------
-- 1. project_phases
-- ---------------------------------------------------------------------

create table if not exists project_phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  client_description text,
  position integer not null default 0,
  state text not null default 'not_started',
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  client_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_phases_name_not_empty check (btrim(name) <> ''),
  constraint project_phases_state_check check (
    state in ('not_started', 'active', 'blocked', 'done')
  )
);

-- No unique(project_id, position): matches
-- 20260903030000_saved_views_position.sql exactly — a unique constraint
-- on a reorderable position column needs deferred updates for every swap,
-- and nothing here reads position as a key, only as a sort.
create index if not exists project_phases_project_id_position_idx
  on project_phases (project_id, position);

drop trigger if exists project_phases_set_updated_at on project_phases;
create trigger project_phases_set_updated_at
  before update on project_phases
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 2. Task columns: phase assignment + page ordering
-- ---------------------------------------------------------------------

alter table tasks add column if not exists phase_id uuid references project_phases (id) on delete set null;
alter table tasks add column if not exists page_slug text;
alter table tasks add column if not exists page_order integer;

create index if not exists tasks_phase_id_idx on tasks (phase_id);
create index if not exists tasks_project_id_page_order_idx on tasks (project_id, page_order);

-- ---------------------------------------------------------------------
-- 3. Project columns: launch header + portal switch
-- ---------------------------------------------------------------------

alter table projects add column if not exists target_launch_date date;
alter table projects add column if not exists launch_confidence text;
alter table projects add column if not exists launch_note text;
alter table projects add column if not exists portal_enabled boolean not null default false;
alter table projects add column if not exists portal_enabled_at timestamptz;

alter table projects drop constraint if exists projects_launch_confidence_check;
alter table projects add constraint projects_launch_confidence_check
  check (launch_confidence is null or launch_confidence in ('on_track', 'at_risk', 'slipped'));

-- ---------------------------------------------------------------------
-- 4. project_statuses.client_description (AS-016)
-- ---------------------------------------------------------------------
-- Nullable; the UI falls back to the status name when it is null, per
-- this feature's clarified spec. No RLS change needed here — this rides
-- on the same `project_statuses` row already gated by
-- `project_statuses_select_visible` (20260824010000).

alter table project_statuses add column if not exists client_description text;

-- ---------------------------------------------------------------------
-- 5. Portal gate predicate
-- ---------------------------------------------------------------------
-- Every SECURITY DEFINER function this migration adds or replaces pins
-- `search_path` to `public, pg_temp` — 20260908010000's lesson: an
-- unqualified `set search_path = public` implicitly searches pg_temp
-- FIRST, and `authenticated` has TEMP privileges by default, so a caller
-- could shadow `projects`/`tasks` with a same-named pg_temp table inside
-- this function's body without the explicit pin.

create or replace function public.is_project_portal_enabled(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.portal_enabled from projects p where p.id = target_project_id),
    false
  );
$$;

-- ---------------------------------------------------------------------
-- 6. RLS: project_phases
-- ---------------------------------------------------------------------
-- Team SELECT/INSERT/UPDATE/DELETE: active workspace member, role not
-- `client`, project visible to them — same shape as every other
-- project-scoped team table (project_statuses, task_types).
--
-- Client SELECT: the `tasks_select_active_members` shape
-- (`client_visible` folded onto `is_project_client`), plus
-- `client_visible = true` on the phase itself, plus the project's
-- `portal_enabled` (AS-007, AS-012).

alter table project_phases enable row level security;

drop policy if exists project_phases_select_team on project_phases;
create policy project_phases_select_team
  on project_phases
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_phases_select_client on project_phases;
create policy project_phases_select_client
  on project_phases
  for select
  to authenticated
  using (
    client_visible
    and public.is_project_visible_to(project_id)
    and public.is_project_client(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_phases_insert_team on project_phases;
create policy project_phases_insert_team
  on project_phases
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_phases_update_team on project_phases;
create policy project_phases_update_team
  on project_phases
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_phases_delete_team on project_phases;
create policy project_phases_delete_team
  on project_phases
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 7. AS-007: fold `portal_enabled` into the tasks client-visibility gate
-- ---------------------------------------------------------------------
-- The new conjunct lives ONLY inside the client half of the OR
-- (`not is_project_client(...) OR (client_visible AND portal_enabled)`),
-- so nothing changes for the team: for every non-client role the first
-- branch is true and Postgres short-circuits before ever evaluating
-- `is_project_portal_enabled`, exactly as 20260902010000's original
-- comment on this policy describes for `client_visible` alone.

drop policy if exists tasks_select_active_members on tasks;
create policy tasks_select_active_members
  on tasks
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_project_visible_to(project_id)
    and (
      not public.is_project_client(project_id)
      or (client_visible and public.is_project_portal_enabled(project_id))
    )
  );

-- `is_task_visible_to` backs comments/attachments/every other "does this
-- task's visibility extend to me" read a client can reach. Without this
-- fold, a client could still read comments on a shared task belonging to
-- a portal-disabled project even though the task row itself is now
-- hidden from them by the policy above.
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
      and (
        not public.is_project_client(t.project_id)
        or (t.client_visible and public.is_project_portal_enabled(t.project_id))
      )
  );
$$;

-- ---------------------------------------------------------------------
-- 8. seed_default_phases — the ten Good Guys phases
-- ---------------------------------------------------------------------
-- SECURITY DEFINER so it can insert regardless of the caller's own
-- `project_phases_insert_team` grant timing, but re-verifies the caller
-- is an active NON-client member of the project's workspace inside the
-- body first — same "security definer bypasses RLS, so re-check the role
-- explicitly" shape `apply_status_template` (20260903010000) uses.
-- Idempotent: a project that already has any phase returns without
-- inserting, so calling this twice never duplicates the ten rows.

create or replace function public.seed_default_phases(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
  v_caller_role text;
  v_existing_count integer;
begin
  select workspace_id into v_workspace_id from projects where id = p_project_id;
  if v_workspace_id is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  select wm.role into v_caller_role
  from workspace_members wm
  where wm.workspace_id = v_workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'active';

  if v_caller_role is null or v_caller_role = 'client' then
    raise exception 'Only an active team member may seed default phases.'
      using errcode = '42501';
  end if;

  select count(*) into v_existing_count
  from project_phases
  where project_id = p_project_id;

  if v_existing_count > 0 then
    return;
  end if;

  insert into project_phases (project_id, name, client_description, position)
  values
    (p_project_id, 'Kick-off & setup', 'Deciding who approves what, and setting up the tools we will work in.', 1),
    (p_project_id, 'Audit & baseline', 'Measuring the current site so we can prove what changed after launch.', 2),
    (p_project_id, 'Site structure', 'Agreeing every page and every URL before anything is designed.', 3),
    (p_project_id, 'Visual direction', 'Choosing the look — moodboard, style, and one design direction.', 4),
    (p_project_id, 'Page design', 'Designing each page in Figma, for your approval, page by page.', 5),
    (p_project_id, 'Assets & content', 'Preparing images and getting the real text onto the pages.', 6),
    (p_project_id, 'Build', 'Building the approved designs in Webflow.', 7),
    (p_project_id, 'Quality assurance', 'A second developer and the designer check every page.', 8),
    (p_project_id, 'Launch', 'Going live, with tracking and redirects verified.', 9),
    (p_project_id, 'Handover', 'Training, documentation, and moving every account into your name.', 10);
end;
$$;

revoke all on function public.seed_default_phases(uuid) from public;
grant execute on function public.seed_default_phases(uuid) to authenticated;
