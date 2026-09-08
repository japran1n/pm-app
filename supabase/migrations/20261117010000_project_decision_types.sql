-- "Who approves what" (project settings): decision types were four
-- HARDCODED values (content/brand/technical/commercial), enforced only by
-- a CHECK constraint on `approval_requests.decision_type` and
-- `project_decision_owners.decision_type`
-- (20260916010000_approval_requests.sql) and mirrored in a TS constant in
-- every UI that lists them. This migration converts decision types into a
-- proper per-project table so a project can add/remove its own types.
--
-- Existing data is NOT lost: every project that already exists gets the
-- old four types backfilled below, in the same order they were shown in
-- the UI, so `approval_requests`/`project_decision_owners` rows written
-- before this migration keep resolving to a real, named row. New projects
-- (lib/actions/projects.ts's createProject) now seed just two: Design and
-- Content, per this feature's own clarified default.
--
-- Deliberately NOT a hard foreign key from approval_requests/
-- project_decision_owners.decision_type back to this table: those two
-- columns stay plain `text` (only the old 4-value CHECK is dropped,
-- replaced with a non-empty check), and validation that a chosen decision
-- type actually exists for the project happens in the Server Actions
-- (lib/actions/approvals.ts's requestApproval / setDecisionOwner), the
-- same layer that already re-validates everything else this table's
-- sibling actions accept. A hard FK here would also retroactively reject
-- any pre-migration data whose `decision_type` value doesn't happen to
-- match a backfilled row's `name` byte-for-byte (case, trailing
-- whitespace, etc.) -- a soft, app-level check degrades to a clear error
-- message instead of a failed migration.

create table if not exists project_decision_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint project_decision_types_name_not_empty check (btrim(name) <> ''),
  -- One name per project (case-sensitive is fine here: the name IS the
  -- value written into approval_requests/project_decision_owners.decision_type,
  -- same "the label is the value" shape the original 4-value CHECK used).
  constraint project_decision_types_project_name_unique unique (project_id, name)
);

create index if not exists project_decision_types_project_id_sort_idx
  on project_decision_types (project_id, sort_order);

-- ---------------------------------------------------------------------
-- RLS: same shape as project_decision_owners (20260916010000) --
-- team SELECT/INSERT/UPDATE/DELETE gated by is_project_workspace_writer
-- (SELECT additionally by is_project_visible_to + not is_project_client,
-- matching every other team-only SELECT in this schema); client SELECT
-- gated by is_project_client + is_project_visible_to + portal_enabled,
-- same as project_decision_owners_select_client. No client write.
-- ---------------------------------------------------------------------

alter table project_decision_types enable row level security;

drop policy if exists project_decision_types_select_team on project_decision_types;
create policy project_decision_types_select_team
  on project_decision_types
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_decision_types_select_client on project_decision_types;
create policy project_decision_types_select_client
  on project_decision_types
  for select
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_decision_types_insert_team on project_decision_types;
create policy project_decision_types_insert_team
  on project_decision_types
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_decision_types_update_team on project_decision_types;
create policy project_decision_types_update_team
  on project_decision_types
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_decision_types_delete_team on project_decision_types;
create policy project_decision_types_delete_team
  on project_decision_types
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- Backfill: every existing project gets the old fixed four, in their
-- original UI order, so no existing approval_requests/
-- project_decision_owners row is left pointing at a decision type that
-- no longer "exists" anywhere in the product.
-- ---------------------------------------------------------------------

insert into project_decision_types (project_id, name, description, sort_order)
select p.id, v.name, v.description, v.sort_order
from projects p
cross join (
  values
    ('content', 'Copy, sitemap structure, wording.', 1),
    ('brand', 'Visual design, moodboards, page layouts.', 2),
    ('technical', 'Integrations, platform, technical scope.', 3),
    ('commercial', 'Pricing, change requests, contracts.', 4)
) as v(name, description, sort_order)
where not exists (
  select 1 from project_decision_types pdt where pdt.project_id = p.id
);

-- ---------------------------------------------------------------------
-- Widen approval_requests.decision_type / project_decision_owners.decision_type:
-- drop the old 4-value CHECK, replace with a plain non-empty check (same
-- shape as approval_requests_title_not_empty in 20260916010000).
-- ---------------------------------------------------------------------

alter table approval_requests
  drop constraint if exists approval_requests_decision_type_check;
alter table approval_requests
  add constraint approval_requests_decision_type_not_empty check (btrim(decision_type) <> '');

alter table project_decision_owners
  drop constraint if exists project_decision_owners_decision_type_check;
alter table project_decision_owners
  add constraint project_decision_owners_decision_type_not_empty check (btrim(decision_type) <> '');
