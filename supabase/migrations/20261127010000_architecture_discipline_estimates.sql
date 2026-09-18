-- Mission 20260918-architecture-enrichment, F01: discipline estimates table.
--
-- PK (task_id, discipline) instead of a surrogate id: "one estimate per
-- discipline per node" is the entire invariant. A surrogate id would allow
-- two 'design' rows for the same task, making rollup ambiguous. Writes use
-- upsert with ON CONFLICT (task_id, discipline).
--
-- discipline reuses the work_category vocabulary verbatim ('design',
-- 'development', 'content_seo', 'pm', 'qa') — the same literal CHECK that
-- time_entries_work_category_check in 20261010010000 defines. Two lists are
-- the existing convention; equality discipline = work_category is what makes
-- estimate-vs-actual comparison a plain = join.
--
-- project_id is denormalized (not derived through tasks join): every RLS
-- policy becomes a direct predicate on the column instead of a subquery,
-- and a project-wide sum is one query with no join. The server action that
-- writes this table ALWAYS derives project_id from the looked-up task row,
-- never from caller payload.
--
-- No trigger to sync tasks.estimate_minutes. Deliberate — recorded here so
-- the next reader does not "fix" it. tasks.estimate_minutes is a separate
-- concept and is not modified by this feature.
--
-- RLS is enabled here; policies are in the companion migration
-- 20261127010000 (appended below after the table definition).
--
-- Existing functions relied on (verified live in Supabase project before
-- writing):
--   set_updated_at() — defined in base migrations, used by project_budgets
--   (20261010010000) and other tables in this schema.

create table if not exists task_discipline_estimates (
  task_id      uuid not null references tasks (id) on delete cascade,
  project_id   uuid not null references projects (id) on delete cascade,
  discipline   text not null check (discipline in ('design','development','content_seo','pm','qa')),
  minutes      integer not null check (minutes > 0),
  note         text,
  estimated_by uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (task_id, discipline)
);

create index if not exists task_discipline_estimates_project_id_idx
  on task_discipline_estimates (project_id);

create index if not exists task_discipline_estimates_project_discipline_idx
  on task_discipline_estimates (project_id, discipline);

drop trigger if exists task_discipline_estimates_set_updated_at on task_discipline_estimates;
create trigger task_discipline_estimates_set_updated_at
  before update on task_discipline_estimates
  for each row
  execute function set_updated_at();

alter table task_discipline_estimates enable row level security;

-- No client SELECT policy is intentional: discipline estimates are
-- commercial data and must never be visible to portal clients. The absence
-- is the rule, not an oversight — see plan section 1.1 and the three-layer
-- protection in lib/queries/architecture-details.ts.

create policy task_discipline_estimates_select_team on task_discipline_estimates
  for select to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

create policy task_discipline_estimates_insert_team on task_discipline_estimates
  for insert to authenticated
  with check (public.is_project_workspace_writer(project_id));

create policy task_discipline_estimates_update_team on task_discipline_estimates
  for update to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

create policy task_discipline_estimates_delete_team on task_discipline_estimates
  for delete to authenticated
  using (public.is_project_workspace_writer(project_id));
