-- F218: project_statuses table + migration of the fixed four
-- (AS-403, AS-407, AS-408).
--
-- Additive, non-destructive: `tasks.status` (text, CHECK-constrained to
-- the fixed four) stays in place and stays the column every existing
-- board/list/filter/RPC/realtime reader uses. This migration only adds:
--   - `project_statuses`: per-project board columns, seeded with the
--     current four (todo, in_progress, in_review, done) for every
--     existing project (AS-403).
--   - `tasks.status_id`: nullable FK to `project_statuses`, backfilled
--     for every existing task from its current `tasks.status` so the
--     column is preserved exactly (AS-408). Kept in sync with
--     `tasks.status` by a trigger so the two never drift apart while
--     both are live (F223 is the feature that finishes migrating readers
--     off `tasks.status` and drops it later, per F270's dedicated
--     cleanup feature).
--   - A trigger on `projects` that seeds the same default four columns
--     for every NEWLY created project, regardless of which code path
--     creates it (AS-407) — see the "creation paths swept" note below.
--
-- RLS reuses `public.is_project_visible_to(project_id)` from
-- supabase/migrations/20260821140526_project_visibility_rls_sweep.sql
-- rather than a copy-pasted predicate, matching that migration's style
-- (full select/insert/update/delete sweep, since project_statuses is a
-- table introduced after that sweep ran).

-- ---------------------------------------------------------------------
-- project_statuses
-- ---------------------------------------------------------------------

create table if not exists project_statuses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  color text not null,
  category text not null check (category in ('not_started', 'in_progress', 'done')),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  constraint project_statuses_name_not_empty check (btrim(name) <> '')
);

-- One board-column-name per project (case-sensitive is fine here; AS-404's
-- rename/add validation is out of this feature's scope — F219/F220 own
-- that action-layer Zod validation per this feature's Clarified
-- implementation answer #7).
create unique index if not exists project_statuses_project_id_name_idx
  on project_statuses (project_id, name);

-- Performance budget (Clarified implementation #8): index the FK and the
-- column this feature's main read path orders by (project board query:
-- "all columns for project X, in board order").
create index if not exists project_statuses_project_id_idx
  on project_statuses (project_id);
create index if not exists project_statuses_project_id_position_idx
  on project_statuses (project_id, position);

alter table project_statuses enable row level security;

drop policy if exists project_statuses_select_visible on project_statuses;
create policy project_statuses_select_visible
  on project_statuses
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
  );

drop policy if exists project_statuses_insert_visible on project_statuses;
create policy project_statuses_insert_visible
  on project_statuses
  for insert
  to authenticated
  with check (
    public.is_project_visible_to(project_id)
  );

drop policy if exists project_statuses_update_visible on project_statuses;
create policy project_statuses_update_visible
  on project_statuses
  for update
  to authenticated
  using (
    public.is_project_visible_to(project_id)
  )
  with check (
    public.is_project_visible_to(project_id)
  );

drop policy if exists project_statuses_delete_visible on project_statuses;
create policy project_statuses_delete_visible
  on project_statuses
  for delete
  to authenticated
  using (
    public.is_project_visible_to(project_id)
  );

-- ---------------------------------------------------------------------
-- tasks.status_id — additive, nullable, kept in sync with tasks.status
-- ---------------------------------------------------------------------

alter table tasks add column if not exists status_id uuid references project_statuses(id);
create index if not exists tasks_status_id_idx on tasks (status_id);

-- ---------------------------------------------------------------------
-- Seed helper: inserts the default four columns for one project and
-- returns nothing. SECURITY DEFINER + no grants to authenticated/anon:
-- only called from the two trigger functions below (BEFORE/AFTER INSERT
-- on `projects`, and the one-time backfill immediately after), never
-- directly by application code.
-- ---------------------------------------------------------------------

create or replace function public.seed_default_project_statuses(target_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into project_statuses (project_id, name, color, category, position)
  values
    (target_project_id, 'todo', '#94a3b8', 'not_started', 1000),
    (target_project_id, 'in_progress', '#3b82f6', 'in_progress', 2000),
    (target_project_id, 'in_review', '#f59e0b', 'in_progress', 3000),
    (target_project_id, 'done', '#22c55e', 'done', 4000)
  on conflict (project_id, name) do nothing;
end;
$$;

revoke all on function public.seed_default_project_statuses(uuid) from public;
grant execute on function public.seed_default_project_statuses(uuid) to service_role;

-- ---------------------------------------------------------------------
-- AS-407: every newly created project gets the default four columns.
--
-- Implemented as an AFTER INSERT trigger on `projects` itself (not in
-- application code) specifically because this feature's spec requires
-- EVERY creation path to be covered, and this codebase currently has two
-- independent project-insert paths that share no common application-layer
-- function:
--   1. lib/actions/projects.ts `createProject` — a plain admin-client
--      `.insert()` into `projects`.
--   2. supabase/migrations/20260822190000_rpc_create_project_from_template.sql
--      `create_project_from_template` — a raw `insert into projects` inside
--      a PL/pgSQL function.
-- A row-level trigger on `projects` fires for both (and any future insert
-- path, including test fixtures and seed scripts) without either
-- caller needing to know project_statuses exists, matching this table's
-- "additive, no new dependency" mandate.
-- ---------------------------------------------------------------------

create or replace function public.seed_default_project_statuses_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_project_statuses(new.id);
  return new;
end;
$$;

drop trigger if exists projects_seed_default_statuses on projects;
create trigger projects_seed_default_statuses
  after insert on projects
  for each row
  execute function public.seed_default_project_statuses_on_insert();

-- ---------------------------------------------------------------------
-- AS-408: backfill every existing project + existing task, preserving
-- status exactly.
-- ---------------------------------------------------------------------

do $$
declare
  v_project record;
begin
  for v_project in select id from projects loop
    perform public.seed_default_project_statuses(v_project.id);
  end loop;
end;
$$;

update tasks t
set status_id = ps.id
from project_statuses ps
where ps.project_id = t.project_id
  and ps.name = t.status
  and t.status_id is null;

-- ---------------------------------------------------------------------
-- Keep status_id in sync with tasks.status while both are live.
--
-- tasks.status remains the column every existing reader (board, list,
-- filter, RPC, realtime) uses until F223 migrates them; this trigger
-- means any write that only sets `status` (the current, unmigrated write
-- path) still keeps `status_id` accurate for early adopters of the new
-- column, and vice versa for any future writer that only sets
-- `status_id`, so neither column can silently drift once both exist.
-- ---------------------------------------------------------------------

create or replace function public.sync_task_status_and_status_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_changed boolean;
  v_status_id_changed boolean;
begin
  v_status_changed := tg_op = 'INSERT' or new.status is distinct from old.status;
  v_status_id_changed := tg_op = 'INSERT' or new.status_id is distinct from old.status_id;

  if v_status_changed and new.status is not null then
    -- `status` text was written (the current, unmigrated write path):
    -- derive status_id from the (project_id, name) pair, matching this
    -- feature's seed data, so status_id never falls behind status.
    select ps.id into new.status_id
    from project_statuses ps
    where ps.project_id = new.project_id
      and ps.name = new.status;
  elsif v_status_id_changed and new.status_id is not null then
    -- Only status_id was written (a future/early caller of the new
    -- column): derive status text from status_id's name so every
    -- existing status-reading path keeps working unchanged.
    select ps.name into new.status
    from project_statuses ps
    where ps.id = new.status_id;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_sync_status_and_status_id on tasks;
create trigger tasks_sync_status_and_status_id
  before insert or update on tasks
  for each row
  execute function public.sync_task_status_and_status_id();
