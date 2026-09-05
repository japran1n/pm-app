-- Client portal phase 2, item B (docs/client-portal-phase-2-plan.md):
-- per-page links. A page is a task with `page_slug` set
-- (20260909010000_portal_foundations.sql). This migration adds
-- `page_links`, keyed on `task_id`, so a page can carry a Figma frame, a
-- staging URL, and later a live URL without three dedicated columns on
-- `tasks` -- a fourth link kind later costs a row, not a migration.
--
-- Every SECURITY DEFINER predicate this migration relies on
-- (`is_project_visible_to`, `is_project_client`, `is_project_portal_enabled`,
-- `is_project_workspace_writer`, `looks_like_credential`) already exists
-- and is already pinned to `public, pg_temp` (20260908010000,
-- 20261014020000) -- this migration adds one new SECURITY DEFINER-free
-- helper (`is_valid_link_kind`, plain `language sql immutable`, no table
-- access, so no search_path hijack surface exists for it) and pins it the
-- same way regardless, for consistency with every other function in this
-- file.

-- ---------------------------------------------------------------------
-- 0. Shared kind vocabulary -- `project_links` and `page_links` both
-- check against this one function so the two lists never drift apart.
-- ---------------------------------------------------------------------
create or replace function public.is_valid_link_kind(kind text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select kind in (
    'staging', 'live', 'figma', 'sitemap', 'drive', 'webflow',
    'gtm', 'analytics', 'search_console', 'other'
  );
$$;

-- Re-point `project_links`'s existing CHECK at the shared function
-- instead of its own inline list (20261014010000) -- same rule, now
-- expressed once.
alter table project_links
  drop constraint if exists project_links_kind_check,
  add constraint project_links_kind_check check (public.is_valid_link_kind(kind));

-- ---------------------------------------------------------------------
-- 1. Credential guard on project_links.url -- the security audit flagged
-- this gap (docs/client-portal-phase-2-plan.md, item B): a basic-auth
-- URL was previously only kept internal by `client_visible` defaulting
-- false, which is a default, not a guarantee. Applies the same
-- `looks_like_credential` check `project_accounts` already carries on
-- `service`/`note` (20261014010000).
-- ---------------------------------------------------------------------
alter table project_links
  drop constraint if exists project_links_url_no_secret_shape,
  add constraint project_links_url_no_secret_shape check (
    not public.looks_like_credential(url)
  );

-- ---------------------------------------------------------------------
-- 2. page_links
-- ---------------------------------------------------------------------
create table if not exists page_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  kind text not null,
  label text not null,
  url text not null,
  client_visible boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_links_label_not_empty check (btrim(label) <> ''),
  constraint page_links_url_not_empty check (btrim(url) <> ''),
  constraint page_links_kind_check check (public.is_valid_link_kind(kind)),
  constraint page_links_url_no_secret_shape check (not public.looks_like_credential(url))
);

create index if not exists page_links_task_id_position_idx
  on page_links (task_id, position);

drop trigger if exists page_links_set_updated_at on page_links;
create trigger page_links_set_updated_at
  before update on page_links
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. RLS: page_links -- reaches the client more often than
-- `project_links` (every row in the Pages table can carry one), so this
-- is the risk this migration actually needs to get right. A page link is
-- client-readable only when: its own `client_visible` is true, its
-- parent TASK is itself client-visible (a page link on a task the client
-- can't see must not leak the task's existence via the link), the parent
-- project is visible to the caller, the caller is a project client, and
-- the project's portal is enabled. Every write is a team write, gated
-- the same way `project_links` already is.
-- ---------------------------------------------------------------------
alter table page_links enable row level security;

drop policy if exists page_links_select_team on page_links;
create policy page_links_select_team
  on page_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from tasks t
      where t.id = page_links.task_id
        and public.is_project_visible_to(t.project_id)
        and not public.is_project_client(t.project_id)
    )
  );

drop policy if exists page_links_select_client on page_links;
create policy page_links_select_client
  on page_links
  for select
  to authenticated
  using (
    page_links.client_visible
    and exists (
      select 1
      from tasks t
      where t.id = page_links.task_id
        and t.client_visible
        and public.is_project_client(t.project_id)
        and public.is_project_visible_to(t.project_id)
        and public.is_project_portal_enabled(t.project_id)
    )
  );

drop policy if exists page_links_insert_team on page_links;
create policy page_links_insert_team
  on page_links
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from tasks t
      where t.id = page_links.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  );

drop policy if exists page_links_update_team on page_links;
create policy page_links_update_team
  on page_links
  for update
  to authenticated
  using (
    exists (
      select 1
      from tasks t
      where t.id = page_links.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  )
  with check (
    exists (
      select 1
      from tasks t
      where t.id = page_links.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  );

drop policy if exists page_links_delete_team on page_links;
create policy page_links_delete_team
  on page_links
  for delete
  to authenticated
  using (
    exists (
      select 1
      from tasks t
      where t.id = page_links.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  );
