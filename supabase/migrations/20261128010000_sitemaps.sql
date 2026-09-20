-- Standalone Sitemap tool, Phase 1: data layer for sitemaps that are NOT
-- tied to any project. Today the Architecture board has no tables of its
-- own -- a "page" is a row in `tasks` with `page_slug` set and
-- `parent_task_id is null`, a "section" is that task's subtask, components
-- live in `page_components` (see lib/queries/architecture.ts's header).
-- That model is inseparable from projects, so this feature gets its own,
-- parallel, project-free tables. This migration does NOT touch `tasks`,
-- `page_components`, or any existing table/policy.
--
-- Vocabulary mirrors the existing BoardPageKind/BoardSectionKind types
-- (lib/queries/architecture.ts) exactly, so the read side can return the
-- same `ArchitectureBoard` shape the existing canvas already renders:
--   sitemap_pages.kind    -- 'static' | 'cms' | 'cms_template' | 'utility' (nullable, mirrors page_kind)
--   sitemap_sections.kind -- 'static' | 'cms' (mirrors section_kind, not nullable)
--
-- RLS: workspace members only, same shape as every other workspace-scoped
-- table in this repo (see e.g. supabase/migrations/20260826010000_create_saved_views.sql's
-- workspace-level branch, and supabase/migrations/20260817222822_rls_workspaces.sql's
-- public.is_active_workspace_member(workspace_id) helper). Child tables
-- (sitemap_pages/sections/components/shares) resolve back to
-- sitemap_id -> sitemaps.workspace_id and gate on the same helper, rather
-- than duplicating a workspace_id column on every child row.
--
-- Public share route note: `sitemap_shares` intentionally has NO select
-- policy that would let an anonymous caller read it via PostgREST/anon
-- key. The public share route (a later phase) resolves a token to a
-- sitemap by using the ADMIN client (lib/supabase/admin.ts, bypasses RLS)
-- server-side, after independently validating the token server-side --
-- it does not, and must not, rely on an anon-role RLS policy. This keeps
-- "who can see a shared sitemap" as an application-layer decision (token
-- validity, revocation) rather than a second RLS branch that would have
-- to reason about unauthenticated callers.
--
-- No password, no expiry, no per-share access-level column: the share
-- link is view-only by design, per this feature's Clarified
-- implementation -- simplicity over configurability for phase 1.

create table if not exists public.sitemaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint sitemaps_name_not_empty check (btrim(name) <> '')
);

create index if not exists sitemaps_workspace_id_idx
  on public.sitemaps (workspace_id);

drop trigger if exists sitemaps_set_updated_at on public.sitemaps;
create trigger sitemaps_set_updated_at
  before update on public.sitemaps
  for each row
  execute function set_updated_at();

create table if not exists public.sitemap_pages (
  id uuid primary key default gen_random_uuid(),
  sitemap_id uuid not null references public.sitemaps (id) on delete cascade,
  title text not null,
  slug text not null,
  kind text check (kind in ('static', 'cms', 'cms_template', 'utility')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sitemap_pages_title_not_empty check (btrim(title) <> ''),
  constraint sitemap_pages_slug_not_empty check (btrim(slug) <> '')
);

-- Main read path: "all pages for this sitemap, in position order" --
-- and the write-side slug-uniqueness check ("does this slug already
-- exist in this sitemap"), mirroring tasks' own
-- (project_id, page_slug) uniqueness check in lib/actions/architecture/pages.ts.
create index if not exists sitemap_pages_sitemap_id_position_idx
  on public.sitemap_pages (sitemap_id, position);
create unique index if not exists sitemap_pages_sitemap_id_slug_idx
  on public.sitemap_pages (sitemap_id, slug);

drop trigger if exists sitemap_pages_set_updated_at on public.sitemap_pages;
create trigger sitemap_pages_set_updated_at
  before update on public.sitemap_pages
  for each row
  execute function set_updated_at();

create table if not exists public.sitemap_components (
  id uuid primary key default gen_random_uuid(),
  sitemap_id uuid not null references public.sitemaps (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sitemap_components_name_not_empty check (btrim(name) <> '')
);

create index if not exists sitemap_components_sitemap_id_position_idx
  on public.sitemap_components (sitemap_id, position);

drop trigger if exists sitemap_components_set_updated_at on public.sitemap_components;
create trigger sitemap_components_set_updated_at
  before update on public.sitemap_components
  for each row
  execute function set_updated_at();

create table if not exists public.sitemap_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.sitemap_pages (id) on delete cascade,
  title text not null,
  kind text not null default 'static' check (kind in ('static', 'cms')),
  component_id uuid references public.sitemap_components (id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sitemap_sections_title_not_empty check (btrim(title) <> '')
);

-- Main read path: "all sections for this page, in position order".
create index if not exists sitemap_sections_page_id_position_idx
  on public.sitemap_sections (page_id, position);
-- Component instance-count read path (mirrors page_components' own
-- component_id grouping in lib/queries/architecture.ts).
create index if not exists sitemap_sections_component_id_idx
  on public.sitemap_sections (component_id) where component_id is not null;

drop trigger if exists sitemap_sections_set_updated_at on public.sitemap_sections;
create trigger sitemap_sections_set_updated_at
  before update on public.sitemap_sections
  for each row
  execute function set_updated_at();

create table if not exists public.sitemap_shares (
  id uuid primary key default gen_random_uuid(),
  sitemap_id uuid not null references public.sitemaps (id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Token -> sitemap resolution is the only read path for this table (via
-- the admin client, see header note above), so it needs a unique index on
-- token alone, not a composite.
create unique index if not exists sitemap_shares_token_idx
  on public.sitemap_shares (token);
create index if not exists sitemap_shares_sitemap_id_idx
  on public.sitemap_shares (sitemap_id);

alter table public.sitemaps enable row level security;
alter table public.sitemap_pages enable row level security;
alter table public.sitemap_components enable row level security;
alter table public.sitemap_sections enable row level security;
alter table public.sitemap_shares enable row level security;

-- sitemaps: full CRUD sweep for active workspace members, same shape as
-- saved_views' workspace-level branch
-- (supabase/migrations/20260826010000_create_saved_views.sql).
drop policy if exists sitemaps_select_member on public.sitemaps;
create policy sitemaps_select_member
  on public.sitemaps
  for select
  to authenticated
  using (public.is_active_workspace_member(workspace_id));

drop policy if exists sitemaps_insert_member on public.sitemaps;
create policy sitemaps_insert_member
  on public.sitemaps
  for insert
  to authenticated
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists sitemaps_update_member on public.sitemaps;
create policy sitemaps_update_member
  on public.sitemaps
  for update
  to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists sitemaps_delete_member on public.sitemaps;
create policy sitemaps_delete_member
  on public.sitemaps
  for delete
  to authenticated
  using (public.is_active_workspace_member(workspace_id));

-- sitemap_pages / sitemap_components / sitemap_sections: no workspace_id
-- column of their own, so every predicate resolves back through the
-- owning sitemap (and, for sections, through the owning page) with an
-- EXISTS subquery against the already-secured parent table.
drop policy if exists sitemap_pages_select_member on public.sitemap_pages;
create policy sitemap_pages_select_member
  on public.sitemap_pages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_pages.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_pages_insert_member on public.sitemap_pages;
create policy sitemap_pages_insert_member
  on public.sitemap_pages
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_pages.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_pages_update_member on public.sitemap_pages;
create policy sitemap_pages_update_member
  on public.sitemap_pages
  for update
  to authenticated
  using (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_pages.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_pages.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_pages_delete_member on public.sitemap_pages;
create policy sitemap_pages_delete_member
  on public.sitemap_pages
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_pages.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_components_select_member on public.sitemap_components;
create policy sitemap_components_select_member
  on public.sitemap_components
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_components.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_components_insert_member on public.sitemap_components;
create policy sitemap_components_insert_member
  on public.sitemap_components
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_components.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_components_update_member on public.sitemap_components;
create policy sitemap_components_update_member
  on public.sitemap_components
  for update
  to authenticated
  using (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_components.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_components.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_components_delete_member on public.sitemap_components;
create policy sitemap_components_delete_member
  on public.sitemap_components
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_components.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_sections_select_member on public.sitemap_sections;
create policy sitemap_sections_select_member
  on public.sitemap_sections
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sitemap_pages p
      join public.sitemaps s on s.id = p.sitemap_id
      where p.id = sitemap_sections.page_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_sections_insert_member on public.sitemap_sections;
create policy sitemap_sections_insert_member
  on public.sitemap_sections
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.sitemap_pages p
      join public.sitemaps s on s.id = p.sitemap_id
      where p.id = sitemap_sections.page_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_sections_update_member on public.sitemap_sections;
create policy sitemap_sections_update_member
  on public.sitemap_sections
  for update
  to authenticated
  using (
    exists (
      select 1 from public.sitemap_pages p
      join public.sitemaps s on s.id = p.sitemap_id
      where p.id = sitemap_sections.page_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.sitemap_pages p
      join public.sitemaps s on s.id = p.sitemap_id
      where p.id = sitemap_sections.page_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_sections_delete_member on public.sitemap_sections;
create policy sitemap_sections_delete_member
  on public.sitemap_sections
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.sitemap_pages p
      join public.sitemaps s on s.id = p.sitemap_id
      where p.id = sitemap_sections.page_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

-- sitemap_shares: workspace members may manage (create/revoke/list) share
-- tokens for their own workspace's sitemaps through this table's own RLS.
-- There is deliberately NO policy granting `anon`/unauthenticated access
-- to this table -- see header note. The public share route reads this
-- table exclusively through the admin client (bypasses RLS entirely)
-- after resolving/validating the token server-side, so "no anon SELECT
-- policy" does not block that route; it only blocks a stray client-side
-- anon-key query from working, which is the intended floor.
drop policy if exists sitemap_shares_select_member on public.sitemap_shares;
create policy sitemap_shares_select_member
  on public.sitemap_shares
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_shares.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_shares_insert_member on public.sitemap_shares;
create policy sitemap_shares_insert_member
  on public.sitemap_shares
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_shares.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_shares_update_member on public.sitemap_shares;
create policy sitemap_shares_update_member
  on public.sitemap_shares
  for update
  to authenticated
  using (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_shares.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_shares.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

drop policy if exists sitemap_shares_delete_member on public.sitemap_shares;
create policy sitemap_shares_delete_member
  on public.sitemap_shares
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.sitemaps s
      where s.id = sitemap_shares.sitemap_id
        and public.is_active_workspace_member(s.workspace_id)
    )
  );

-- No policy for anon on any of the five tables above: absence of a
-- matching policy denies access by default under RLS, matching this
-- repo's established convention (see saved_views migration's closing
-- comment).
