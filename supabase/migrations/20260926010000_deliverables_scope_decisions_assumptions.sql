-- F012 (missions/20260903-portal, M3 — Your list, scope, decisions):
-- four project-scoped tables — `client_deliverables`, `project_scope_items`,
-- `project_decisions`, `project_assumptions` — the PM lists this
-- milestone's client-facing views (F014, F015) read from.
--
-- `project_risks` is deliberately NOT part of this migration. It is one of
-- the four PM lists in the plan documents, but it is almost always
-- internal-only, and a table nobody fills is worse than no table. This is
-- a decision, not an omission — see the feature spec's own section 5.
--
-- Every SECURITY DEFINER predicate this migration adds pins `search_path`
-- to `public, pg_temp` from the start (20260908010000's lesson, restated
-- in every migration since: an unqualified `set search_path = public`
-- implicitly searches pg_temp FIRST, and `authenticated` has TEMP
-- privileges by default, so a caller could shadow a table this function
-- reads with a same-named pg_temp table inside the function body without
-- the explicit pin).
--
-- Shape, per table:
--   - `client_deliverables` / `project_scope_items` have no
--     `client_visible` column of their own: everything in each is, by
--     definition, a client-facing artefact (a deliverable the client owes,
--     a scope decision that was made) — there is no internal-only variant
--     to hide, unlike a task or a decision. Their client SELECT policy
--     gates on membership + project visibility + `portal_enabled` only.
--   - `project_decisions` / `project_assumptions` carry an explicit
--     `client_visible boolean not null default true` — a technical
--     decision the team makes is very often not one the client should see
--     the internal reasoning for (AS-044, AS-045). Their client SELECT
--     policy additionally requires `client_visible`.
--   - No table gets an INSERT/UPDATE/DELETE policy for the client role at
--     all: every write is a team write (`is_project_workspace_writer`),
--     except `project_assumptions.flagged_by_client_at` /
--     `flagged_note`, which F015's `flag_assumption_atomic` RPC alone can
--     set — not built here, out of this feature's scope per its own spec.

-- ---------------------------------------------------------------------
-- 1. client_deliverables
-- ---------------------------------------------------------------------

create table if not exists client_deliverables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  phase_id uuid references project_phases (id) on delete set null,
  task_id uuid references tasks (id) on delete set null,
  title text not null,
  description text,
  kind text not null,
  owner_name text not null,
  due_at date,
  blocking boolean not null default false,
  state text not null default 'not_started',
  delivered_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  review_note text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_deliverables_title_not_empty check (btrim(title) <> ''),
  constraint client_deliverables_owner_name_not_empty check (btrim(owner_name) <> ''),
  constraint client_deliverables_kind_check check (
    kind in ('copy', 'image', 'access', 'decision', 'data', 'other')
  ),
  constraint client_deliverables_state_check check (
    state in ('not_started', 'in_progress', 'delivered', 'accepted', 'waived')
  )
);

create index if not exists client_deliverables_project_id_position_idx
  on client_deliverables (project_id, position);
create index if not exists client_deliverables_task_id_idx
  on client_deliverables (task_id);
-- F014's overdue-blocking read (AS-030, AS-031) and this migration's own
-- `getPortalBadgeCounts` extension (section 7 below): a partial index on
-- exactly the predicate that query filters on.
create index if not exists client_deliverables_project_id_blocking_due_idx
  on client_deliverables (project_id, due_at)
  where blocking and state not in ('accepted', 'waived');

drop trigger if exists client_deliverables_set_updated_at on client_deliverables;
create trigger client_deliverables_set_updated_at
  before update on client_deliverables
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 2. project_scope_items
-- ---------------------------------------------------------------------

create table if not exists project_scope_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  description text,
  included boolean not null,
  source text not null,
  change_request_id uuid references client_requests (id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint project_scope_items_title_not_empty check (btrim(title) <> ''),
  constraint project_scope_items_source_check check (
    source in ('proposal', 'change_request')
  )
);

create index if not exists project_scope_items_project_id_position_idx
  on project_scope_items (project_id, position);
create index if not exists project_scope_items_change_request_id_idx
  on project_scope_items (change_request_id);

-- ---------------------------------------------------------------------
-- 3. project_decisions
-- ---------------------------------------------------------------------

create table if not exists project_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  phase_id uuid references project_phases (id) on delete set null,
  title text not null,
  rationale text,
  decision_type text not null,
  decided_on date not null default current_date,
  decided_by_name text,
  client_visible boolean not null default true,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint project_decisions_title_not_empty check (btrim(title) <> ''),
  constraint project_decisions_decision_type_check check (
    decision_type in ('content', 'brand', 'technical', 'commercial')
  )
);

create index if not exists project_decisions_project_id_decided_on_idx
  on project_decisions (project_id, decided_on desc);

-- ---------------------------------------------------------------------
-- 4. project_assumptions
-- ---------------------------------------------------------------------

create table if not exists project_assumptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  text text not null,
  state text not null default 'assumed',
  confirmed_on date,
  confirmed_by_name text,
  client_visible boolean not null default true,
  -- The "Not correct" button (F015's `flag_assumption_atomic`): the one
  -- pair of columns on any of these four tables a client may ever cause
  -- to be written, and only through that RPC — no client UPDATE policy
  -- exists on this table (or any of the other three) below.
  flagged_by_client_at timestamptz,
  flagged_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_assumptions_text_not_empty check (btrim(text) <> ''),
  constraint project_assumptions_state_check check (
    state in ('assumed', 'confirmed', 'invalidated')
  )
);

create index if not exists project_assumptions_project_id_idx
  on project_assumptions (project_id);

drop trigger if exists project_assumptions_set_updated_at on project_assumptions;
create trigger project_assumptions_set_updated_at
  before update on project_assumptions
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 5. RLS: client_deliverables
-- ---------------------------------------------------------------------
-- Team: the standard "project visible to me and I am not a client"
-- shape every project-scoped team table in this schema uses
-- (project_phases, approval_requests, project_decision_owners, ...).
-- Client SELECT: membership + project visibility + portal_enabled — no
-- extra `client_visible` conjunct, per this table's own "everything here
-- is inherently client-facing" reasoning above.

alter table client_deliverables enable row level security;

drop policy if exists client_deliverables_select_team on client_deliverables;
create policy client_deliverables_select_team
  on client_deliverables
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists client_deliverables_select_client on client_deliverables;
create policy client_deliverables_select_client
  on client_deliverables
  for select
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists client_deliverables_insert_team on client_deliverables;
create policy client_deliverables_insert_team
  on client_deliverables
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists client_deliverables_update_team on client_deliverables;
create policy client_deliverables_update_team
  on client_deliverables
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists client_deliverables_delete_team on client_deliverables;
create policy client_deliverables_delete_team
  on client_deliverables
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 6. RLS: project_scope_items
-- ---------------------------------------------------------------------

alter table project_scope_items enable row level security;

drop policy if exists project_scope_items_select_team on project_scope_items;
create policy project_scope_items_select_team
  on project_scope_items
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_scope_items_select_client on project_scope_items;
create policy project_scope_items_select_client
  on project_scope_items
  for select
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_scope_items_insert_team on project_scope_items;
create policy project_scope_items_insert_team
  on project_scope_items
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_scope_items_update_team on project_scope_items;
create policy project_scope_items_update_team
  on project_scope_items
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_scope_items_delete_team on project_scope_items;
create policy project_scope_items_delete_team
  on project_scope_items
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 7. RLS: project_decisions
-- ---------------------------------------------------------------------
-- Client SELECT additionally requires `client_visible` (AS-044, AS-045):
-- this is the table where a decision can genuinely be internal-only (a
-- technical call the team made and never surfaced).

alter table project_decisions enable row level security;

drop policy if exists project_decisions_select_team on project_decisions;
create policy project_decisions_select_team
  on project_decisions
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_decisions_select_client on project_decisions;
create policy project_decisions_select_client
  on project_decisions
  for select
  to authenticated
  using (
    client_visible
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_decisions_insert_team on project_decisions;
create policy project_decisions_insert_team
  on project_decisions
  for insert
  to authenticated
  with check (
    public.is_project_workspace_writer(project_id)
    and created_by = auth.uid()
  );

drop policy if exists project_decisions_update_team on project_decisions;
create policy project_decisions_update_team
  on project_decisions
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_decisions_delete_team on project_decisions;
create policy project_decisions_delete_team
  on project_decisions
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 8. RLS: project_assumptions
-- ---------------------------------------------------------------------
-- Same `client_visible` conjunct as project_decisions. No client
-- UPDATE policy at all — `flagged_by_client_at`/`flagged_note` are only
-- ever written by F015's SECURITY DEFINER `flag_assumption_atomic`,
-- which bypasses RLS as its owner the same way every other atomic RPC in
-- this schema does; a policy that let a client UPDATE this table
-- directly would let them rewrite `state`/`text` too, not just flag it.

alter table project_assumptions enable row level security;

drop policy if exists project_assumptions_select_team on project_assumptions;
create policy project_assumptions_select_team
  on project_assumptions
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_assumptions_select_client on project_assumptions;
create policy project_assumptions_select_client
  on project_assumptions
  for select
  to authenticated
  using (
    client_visible
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_assumptions_insert_team on project_assumptions;
create policy project_assumptions_insert_team
  on project_assumptions
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_assumptions_update_team on project_assumptions;
create policy project_assumptions_update_team
  on project_assumptions
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_assumptions_delete_team on project_assumptions;
create policy project_assumptions_delete_team
  on project_assumptions
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));
