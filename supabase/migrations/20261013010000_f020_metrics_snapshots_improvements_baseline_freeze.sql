-- F020 (missions/20260903-portal, M4 — Hours and results): the migration
-- half of "metrics and improvements" — `project_metrics`,
-- `metric_snapshots`, `project_improvements`, and the baseline freeze
-- mechanism (`projects.baseline_frozen_at` + a trigger). F021's portal
-- Results view (AS-042) reads all three tables; this migration is the
-- team-writable source of truth they read from.
--
-- Two things carry the weight of this feature, per its own spec:
--
--   1. `direction` ('higher' | 'lower') is not decoration. For a metric
--      like LCP, lower is better; for sessions, higher is. A chart that
--      always paints "up" as good tells the client the opposite of the
--      truth on half the rows. This migration only stores the column —
--      F021 is the one that must read it, not invert it.
--
--   2. The freeze trigger is the mechanical form of the process rule
--      that the metric list is fixed in Phase 1 (Audit & baseline) and
--      re-measured identically afterward. Learning from F011b's own
--      immutability trigger (20260924010000): guard the two baseline
--      fields BY NAME (`baseline_value`, `baseline_at`), not every
--      column of the row — F011b's header documents exactly why
--      blocking the whole row via a status check breaks an unrelated FK
--      referential action later; naming the guarded fields avoids that
--      failure mode here too (e.g. `client_visible`, `position`, `name`
--      must all stay editable on a frozen metric — only the baseline
--      itself freezes).
--
-- Shape, per table (same "client_visible column + two-tier RLS" pattern
-- as `project_decisions`/`project_assumptions`, 20260926010000):
--   - `project_metrics` / `project_improvements` carry their own
--     `client_visible boolean not null default true` — the Definition of
--     done's failure test requires a client_visible=false row (and its
--     effect on every aggregate) to be provably absent from portal
--     queries, so the flag must exist per-row on both tables that a
--     portal view actually renders.
--   - `metric_snapshots` has no `client_visible` of its own: visibility
--     always follows its parent metric's `client_visible` (a snapshot of
--     a hidden metric is not somehow visible on its own), enforced via a
--     join in its RLS predicates rather than a duplicated flag that
--     could drift from the parent's.
--
-- No RPC is added for freezing: design constraint 6 ("multi-table writes
-- go through an RPC") does not apply here — freezing writes exactly one
-- column on one table (`projects.baseline_frozen_at`), so it goes
-- through the ordinary team UPDATE path (lib/actions/metrics.ts), with
-- `projects_update_team`'s existing RLS (unchanged by this migration) as
-- the enforcement boundary, same as any other single-column project
-- setting write in this schema.
--
-- Trigger functions created below are picked up by F016i's own event
-- trigger (20261007010000, `ON ddl_command_end WHEN TAG IN ('CREATE
-- FUNCTION')`) and have `EXECUTE` revoked from `public`/`anon`/
-- `authenticated` automatically — no manual `revoke execute` statement
-- needed here, and none is written, per that migration's own documented
-- mechanism (verified: neither function is `CREATE OR REPLACE` on a
-- pre-existing oid, so the event trigger's new-oid gate fires for both).

-- ---------------------------------------------------------------------
-- 0. projects.baseline_frozen_at
-- ---------------------------------------------------------------------

alter table projects
  add column if not exists baseline_frozen_at timestamptz;

-- ---------------------------------------------------------------------
-- 1. project_metrics
-- ---------------------------------------------------------------------

create table if not exists project_metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  unit text,
  source text not null,
  baseline_value numeric,
  baseline_at date,
  target_value numeric,
  direction text not null default 'higher',
  display_max numeric,
  client_visible boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_metrics_name_not_empty check (btrim(name) <> ''),
  constraint project_metrics_source_check check (
    source in ('gsc', 'ga4', 'lighthouse', 'crux', 'manual', 'other')
  ),
  constraint project_metrics_direction_check check (
    direction in ('higher', 'lower')
  )
);

create index if not exists project_metrics_project_id_position_idx
  on project_metrics (project_id, position);

drop trigger if exists project_metrics_set_updated_at on project_metrics;
create trigger project_metrics_set_updated_at
  before update on project_metrics
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 2. metric_snapshots
-- ---------------------------------------------------------------------

create table if not exists metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references project_metrics (id) on delete cascade,
  value numeric not null,
  measured_at date not null,
  note text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists metric_snapshots_metric_id_measured_at_idx
  on metric_snapshots (metric_id, measured_at desc);

-- ---------------------------------------------------------------------
-- 3. project_improvements
-- ---------------------------------------------------------------------

create table if not exists project_improvements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  area text not null,
  explanation text not null,
  -- Object paths inside the existing `task-attachments` Storage bucket
  -- (20260818050100), NOT public URLs — see the storage policies below,
  -- which reuse that bucket's own "authorize via a join back to an app
  -- table" technique (that migration's own header comment) rather than
  -- introducing a second bucket.
  before_path text,
  after_path text,
  position integer not null default 0,
  client_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_improvements_area_not_empty check (btrim(area) <> ''),
  constraint project_improvements_explanation_not_empty check (btrim(explanation) <> '')
);

create index if not exists project_improvements_project_id_position_idx
  on project_improvements (project_id, position);

drop trigger if exists project_improvements_set_updated_at on project_improvements;
create trigger project_improvements_set_updated_at
  before update on project_improvements
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Freeze trigger (AS-040) — the mechanical form of the process rule.
-- ---------------------------------------------------------------------
-- Guards `baseline_value`/`baseline_at` BY NAME, not the whole row — see
-- this migration's header for why (F011b's own lesson). Every other
-- column of a frozen metric (`name`, `client_visible`, `position`,
-- `target_value`, `display_max`, ...) stays freely editable; only the
-- one pair of fields the process treats as "the before" is locked.

create or replace function public.prevent_frozen_baseline_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_frozen_at timestamptz;
begin
  if NEW.baseline_value is distinct from OLD.baseline_value
     or NEW.baseline_at is distinct from OLD.baseline_at
  then
    select p.baseline_frozen_at
      into v_frozen_at
      from public.projects p
     where p.id = OLD.project_id;

    if v_frozen_at is not null then
      raise exception
        'project_metrics: baseline is frozen for this project and cannot be changed (metric_id=%, project_id=%)',
        OLD.id, OLD.project_id
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists project_metrics_prevent_frozen_baseline_update on project_metrics;
create trigger project_metrics_prevent_frozen_baseline_update
  before update on project_metrics
  for each row
  execute function public.prevent_frozen_baseline_update();

-- ---------------------------------------------------------------------
-- 5. RLS: project_metrics
-- ---------------------------------------------------------------------

alter table project_metrics enable row level security;

drop policy if exists project_metrics_select_team on project_metrics;
create policy project_metrics_select_team
  on project_metrics
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_metrics_select_client on project_metrics;
create policy project_metrics_select_client
  on project_metrics
  for select
  to authenticated
  using (
    client_visible
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_metrics_insert_team on project_metrics;
create policy project_metrics_insert_team
  on project_metrics
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_metrics_update_team on project_metrics;
create policy project_metrics_update_team
  on project_metrics
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_metrics_delete_team on project_metrics;
create policy project_metrics_delete_team
  on project_metrics
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 6. RLS: metric_snapshots — visibility follows the parent metric's
--    client_visible via a join; no client write path at all (a snapshot
--    is always a team-entered measurement, per this feature's own scope
--    — "manual entry is v1").
-- ---------------------------------------------------------------------

alter table metric_snapshots enable row level security;

drop policy if exists metric_snapshots_select_team on metric_snapshots;
create policy metric_snapshots_select_team
  on metric_snapshots
  for select
  to authenticated
  using (
    exists (
      select 1
      from project_metrics pm
      where pm.id = metric_snapshots.metric_id
        and public.is_project_visible_to(pm.project_id)
        and not public.is_project_client(pm.project_id)
    )
  );

drop policy if exists metric_snapshots_select_client on metric_snapshots;
create policy metric_snapshots_select_client
  on metric_snapshots
  for select
  to authenticated
  using (
    exists (
      select 1
      from project_metrics pm
      where pm.id = metric_snapshots.metric_id
        and pm.client_visible
        and public.is_project_client(pm.project_id)
        and public.is_project_visible_to(pm.project_id)
        and public.is_project_portal_enabled(pm.project_id)
    )
  );

drop policy if exists metric_snapshots_insert_team on metric_snapshots;
create policy metric_snapshots_insert_team
  on metric_snapshots
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from project_metrics pm
      where pm.id = metric_snapshots.metric_id
        and public.is_project_workspace_writer(pm.project_id)
    )
  );

drop policy if exists metric_snapshots_delete_team on metric_snapshots;
create policy metric_snapshots_delete_team
  on metric_snapshots
  for delete
  to authenticated
  using (
    exists (
      select 1
      from project_metrics pm
      where pm.id = metric_snapshots.metric_id
        and public.is_project_workspace_writer(pm.project_id)
    )
  );

-- No UPDATE policy on metric_snapshots: a mismeasured entry is deleted
-- and re-entered, not edited in place — keeps every snapshot an honest,
-- append-only record of what was measured and when, matching AS-040's
-- own "later measurements are recorded as separate snapshots" text.

-- ---------------------------------------------------------------------
-- 7. RLS: project_improvements
-- ---------------------------------------------------------------------

alter table project_improvements enable row level security;

drop policy if exists project_improvements_select_team on project_improvements;
create policy project_improvements_select_team
  on project_improvements
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_improvements_select_client on project_improvements;
create policy project_improvements_select_client
  on project_improvements
  for select
  to authenticated
  using (
    client_visible
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_improvements_insert_team on project_improvements;
create policy project_improvements_insert_team
  on project_improvements
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_improvements_update_team on project_improvements;
create policy project_improvements_update_team
  on project_improvements
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_improvements_delete_team on project_improvements;
create policy project_improvements_delete_team
  on project_improvements
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 8. Storage: before/after images reuse the existing `task-attachments`
--    bucket (20260818050100) and its own "authorize via a join back to
--    an app table" technique, rather than a new bucket.
--
--    Path convention this migration establishes (binding for the team
--    UI's upload flow): objects live at
--      improvements/{project_id}/{uuid-or-filename}
--    i.e. the object's second path segment is the owning project's id.
--    `project_improvements.before_path`/`after_path` store this same
--    object path (not a public URL).
-- ---------------------------------------------------------------------

-- SELECT: a team member of the project, OR an eligible client (matches
-- the table's own two-tier RLS above), may read the object — needed so
-- both the team settings panel and F021's portal Results view can
-- request a signed URL for the same object.
drop policy if exists project_improvements_objects_select on storage.objects;
create policy project_improvements_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and exists (
      select 1
      from project_improvements pi
      where (pi.before_path = storage.objects.name or pi.after_path = storage.objects.name)
        and (
          (
            public.is_project_visible_to(pi.project_id)
            and not public.is_project_client(pi.project_id)
          )
          or (
            pi.client_visible
            and public.is_project_client(pi.project_id)
            and public.is_project_visible_to(pi.project_id)
            and public.is_project_portal_enabled(pi.project_id)
          )
        )
    )
  );

-- INSERT (upload): the `project_improvements` row does not exist yet at
-- upload time (same ordering problem the original attachments bucket's
-- own INSERT policy comment describes), so this parses `project_id` out
-- of the object path's second segment and checks
-- is_project_workspace_writer directly, matching that migration's own
-- `attachments_objects_insert_active_members` technique one level over
-- (first segment there is `task_id`; here it's the literal literal
-- `improvements` folder, so the id is the SECOND segment).
drop policy if exists project_improvements_objects_insert on storage.objects;
create policy project_improvements_objects_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'task-attachments'
    and split_part(storage.objects.name, '/', 1) = 'improvements'
    and public.is_project_workspace_writer(
      (nullif(split_part(storage.objects.name, '/', 2), ''))::uuid
    )
  );

-- No UPDATE/DELETE policy on storage.objects: replacing an image is a
-- new upload + a new path written onto the row (old object left orphaned
-- rather than overwritten in place), matching this bucket's existing
-- no-delete-policy stance for task attachments (F064's own scope
-- boundary, unchanged here).
