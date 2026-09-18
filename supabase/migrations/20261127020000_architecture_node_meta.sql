-- Mission 20260918-architecture-enrichment, F03: per-node copy brief metadata.
--
-- Why a separate 1:1 table instead of columns on tasks:
--   1. tasks already carries 5+ architecture columns plus client_visible;
--      adding 6 more would make a majority of each row architecture-specific
--      for ~1% of tasks that are pages or sections.
--   2. These fields are sparse — a regular non-architecture task would carry
--      six permanent NULLs.
--   3. Separability is a security property: the portal read path simply does
--      not SELECT this table, whereas a column on tasks would travel inside
--      the shared TASK_COLUMNS constant (the same §D.1 failure class
--      documented in missions/20260915-status-sitemap-audit/audit-sitemap.md).
--
-- Applies to both pages and sections — intent at section level is the heart
-- of the copy brief. No CHECK restricting to pages-only, consistent with
-- how page_slug and parent_task_id are used to distinguish pages vs sections
-- (standing decision 1).
--
-- keywords text[] follows tasks.tags text[] precedent
-- (20260818013434_create_tasks.sql). Dedup and cross-page keyword analysis
-- are in-memory operations over the already-loaded board. GIN index covers
-- future server-side search. Bounded to 30 to prevent paste-bomb inflation.
--
-- client_visible defaults false. The companion RLS migration (F04) adds a
-- client SELECT policy with all four conjuncts. In this phase, no portal
-- surface reads this table — client_visible is reserved for a future phase.
--
-- RLS is enabled here; policies are in 20261127020000 (appended below).

create table if not exists architecture_node_meta (
  task_id        uuid primary key references tasks (id) on delete cascade,
  project_id     uuid not null references projects (id) on delete cascade,
  intent         text,
  audience       text,
  primary_cta    text,
  tone           text,
  keywords       text[] not null default '{}',
  copy_status    text not null default 'not_started'
    check (copy_status in ('not_started','brief_ready','drafted','in_review','approved')),
  client_visible boolean not null default false,
  updated_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint architecture_node_meta_keywords_bounded
    check (array_length(keywords, 1) is null or array_length(keywords, 1) <= 30)
);

create index if not exists architecture_node_meta_project_id_idx
  on architecture_node_meta (project_id);

create index if not exists architecture_node_meta_keywords_gin
  on architecture_node_meta using gin (keywords);

drop trigger if exists architecture_node_meta_set_updated_at on architecture_node_meta;
create trigger architecture_node_meta_set_updated_at
  before update on architecture_node_meta
  for each row
  execute function set_updated_at();

alter table architecture_node_meta enable row level security;

-- Team policies
create policy architecture_node_meta_select_team on architecture_node_meta
  for select to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

create policy architecture_node_meta_insert_team on architecture_node_meta
  for insert to authenticated
  with check (public.is_project_workspace_writer(project_id));

create policy architecture_node_meta_update_team on architecture_node_meta
  for update to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

create policy architecture_node_meta_delete_team on architecture_node_meta
  for delete to authenticated
  using (public.is_project_workspace_writer(project_id));

-- Client SELECT: all four conjuncts — membership + role + portal_enabled +
-- client_visible. intent may surface in the portal in a future phase;
-- for now client_visible defaults false so nothing is exposed.
create policy architecture_node_meta_select_client on architecture_node_meta
  for select to authenticated
  using (
    public.is_project_visible_to(project_id)
    and public.is_project_client(project_id)
    and public.is_project_portal_enabled(project_id)
    and client_visible = true
  );
