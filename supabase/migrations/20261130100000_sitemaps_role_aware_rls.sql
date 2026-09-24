-- Sitemap tool security hardening (audit 2026-09-24).
--
-- 20261128010000_sitemaps.sql gated every one of its 20 policies on
-- public.is_active_workspace_member(...) alone -- ANY active role, which
-- includes 'client' (external party, portal only) and 'guest'
-- (project-scoped collaborator). Through PostgREST a client or guest could
-- therefore read every agency sitemap, create/rename/delete sitemaps and
-- their pages/sections/components, and mint, list or revoke PUBLIC share
-- tokens -- and any member could un-revoke a revoked share by setting
-- `revoked_at = null`.
--
-- The sitemap tool is a team tool (/w/[slug]/tools/sitemap; clients are
-- redirected out of (workspace) to the portal, and the portal never reads
-- these tables -- its Architecture view is the project-backed `tasks`
-- model). Audience after this migration:
--
--   read  (select)                 owner, admin, member, viewer
--   write (insert/update/delete)   owner, admin, member
--   share tokens (create/revoke)   owner, admin, member
--   guest, client                  nothing
--
-- Same allow-list as canTeamWrite() in lib/auth/permissions.ts, which the
-- server actions in lib/actions/sitemaps.ts now re-check too.
--
-- Two sitemap-scoped SECURITY DEFINER helpers carry the role check so the
-- child-table policies (pages/components/sections/shares -- none has its
-- own workspace_id) stay one call each instead of repeating a
-- workspace_members join per policy.
--
-- Share rows additionally get:
--   * a token shape check (base64url, >= 43 chars = the 32 random bytes
--     lib/sitemaps/share-token.ts generates; a hand-rolled short token
--     inserted through PostgREST is refused),
--   * at most one active (unrevoked) share per sitemap, which the app
--     already assumes (listActiveSitemapShareTokens keys by sitemap_id),
--   * an immutability trigger: token and sitemap_id never change, and a
--     revoked share can never be un-revoked or re-dated -- revocation is
--     final for every caller, service role included.
--
-- Live data at authoring time: 0 share rows, so the constraint and the
-- partial unique index cannot fail on existing rows.

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.can_read_sitemap(target_sitemap_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.sitemaps s
    join public.workspace_members wm on wm.workspace_id = s.workspace_id
    where s.id = target_sitemap_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and wm.role in ('owner', 'admin', 'member', 'viewer')
  );
$$;

revoke all on function public.can_read_sitemap(uuid) from public;
revoke all on function public.can_read_sitemap(uuid) from anon;
grant execute on function public.can_read_sitemap(uuid) to authenticated;

create or replace function public.can_write_sitemap(target_sitemap_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.sitemaps s
    join public.workspace_members wm on wm.workspace_id = s.workspace_id
    where s.id = target_sitemap_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and wm.role in ('owner', 'admin', 'member')
  );
$$;

revoke all on function public.can_write_sitemap(uuid) from public;
revoke all on function public.can_write_sitemap(uuid) from anon;
grant execute on function public.can_write_sitemap(uuid) to authenticated;

-- Workspace-level variant for the sitemaps table itself (insert has no
-- sitemap id to resolve yet).
create or replace function public.can_read_workspace_sitemaps(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and wm.role in ('owner', 'admin', 'member', 'viewer')
  );
$$;

revoke all on function public.can_read_workspace_sitemaps(uuid) from public;
revoke all on function public.can_read_workspace_sitemaps(uuid) from anon;
grant execute on function public.can_read_workspace_sitemaps(uuid) to authenticated;

create or replace function public.can_write_workspace_sitemaps(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and wm.role in ('owner', 'admin', 'member')
  );
$$;

revoke all on function public.can_write_workspace_sitemaps(uuid) from public;
revoke all on function public.can_write_workspace_sitemaps(uuid) from anon;
grant execute on function public.can_write_workspace_sitemaps(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- sitemaps
-- ---------------------------------------------------------------------

drop policy if exists sitemaps_select_member on public.sitemaps;
drop policy if exists sitemaps_insert_member on public.sitemaps;
drop policy if exists sitemaps_update_member on public.sitemaps;
drop policy if exists sitemaps_delete_member on public.sitemaps;

create policy sitemaps_select_team
  on public.sitemaps for select to authenticated
  using (public.can_read_workspace_sitemaps(workspace_id));

create policy sitemaps_insert_team
  on public.sitemaps for insert to authenticated
  with check (public.can_write_workspace_sitemaps(workspace_id));

create policy sitemaps_update_team
  on public.sitemaps for update to authenticated
  using (public.can_write_workspace_sitemaps(workspace_id))
  with check (public.can_write_workspace_sitemaps(workspace_id));

create policy sitemaps_delete_team
  on public.sitemaps for delete to authenticated
  using (public.can_write_workspace_sitemaps(workspace_id));

-- ---------------------------------------------------------------------
-- sitemap_pages
-- ---------------------------------------------------------------------

drop policy if exists sitemap_pages_select_member on public.sitemap_pages;
drop policy if exists sitemap_pages_insert_member on public.sitemap_pages;
drop policy if exists sitemap_pages_update_member on public.sitemap_pages;
drop policy if exists sitemap_pages_delete_member on public.sitemap_pages;

create policy sitemap_pages_select_team
  on public.sitemap_pages for select to authenticated
  using (public.can_read_sitemap(sitemap_id));

create policy sitemap_pages_insert_team
  on public.sitemap_pages for insert to authenticated
  with check (public.can_write_sitemap(sitemap_id));

create policy sitemap_pages_update_team
  on public.sitemap_pages for update to authenticated
  using (public.can_write_sitemap(sitemap_id))
  with check (public.can_write_sitemap(sitemap_id));

create policy sitemap_pages_delete_team
  on public.sitemap_pages for delete to authenticated
  using (public.can_write_sitemap(sitemap_id));

-- ---------------------------------------------------------------------
-- sitemap_components
-- ---------------------------------------------------------------------

drop policy if exists sitemap_components_select_member on public.sitemap_components;
drop policy if exists sitemap_components_insert_member on public.sitemap_components;
drop policy if exists sitemap_components_update_member on public.sitemap_components;
drop policy if exists sitemap_components_delete_member on public.sitemap_components;

create policy sitemap_components_select_team
  on public.sitemap_components for select to authenticated
  using (public.can_read_sitemap(sitemap_id));

create policy sitemap_components_insert_team
  on public.sitemap_components for insert to authenticated
  with check (public.can_write_sitemap(sitemap_id));

create policy sitemap_components_update_team
  on public.sitemap_components for update to authenticated
  using (public.can_write_sitemap(sitemap_id))
  with check (public.can_write_sitemap(sitemap_id));

create policy sitemap_components_delete_team
  on public.sitemap_components for delete to authenticated
  using (public.can_write_sitemap(sitemap_id));

-- ---------------------------------------------------------------------
-- sitemap_sections (page_id -> sitemap_pages.sitemap_id)
-- ---------------------------------------------------------------------

drop policy if exists sitemap_sections_select_member on public.sitemap_sections;
drop policy if exists sitemap_sections_insert_member on public.sitemap_sections;
drop policy if exists sitemap_sections_update_member on public.sitemap_sections;
drop policy if exists sitemap_sections_delete_member on public.sitemap_sections;

create policy sitemap_sections_select_team
  on public.sitemap_sections for select to authenticated
  using (
    exists (
      select 1 from public.sitemap_pages p
      where p.id = sitemap_sections.page_id
        and public.can_read_sitemap(p.sitemap_id)
    )
  );

create policy sitemap_sections_insert_team
  on public.sitemap_sections for insert to authenticated
  with check (
    exists (
      select 1 from public.sitemap_pages p
      where p.id = sitemap_sections.page_id
        and public.can_write_sitemap(p.sitemap_id)
    )
  );

create policy sitemap_sections_update_team
  on public.sitemap_sections for update to authenticated
  using (
    exists (
      select 1 from public.sitemap_pages p
      where p.id = sitemap_sections.page_id
        and public.can_write_sitemap(p.sitemap_id)
    )
  )
  with check (
    exists (
      select 1 from public.sitemap_pages p
      where p.id = sitemap_sections.page_id
        and public.can_write_sitemap(p.sitemap_id)
    )
  );

create policy sitemap_sections_delete_team
  on public.sitemap_sections for delete to authenticated
  using (
    exists (
      select 1 from public.sitemap_pages p
      where p.id = sitemap_sections.page_id
        and public.can_write_sitemap(p.sitemap_id)
    )
  );

-- A section may only link a component of its OWN sitemap. Enforced in the
-- database (not just in linkSitemapComponentToSection) so neither a direct
-- PostgREST write nor a future action can point a section at another
-- sitemap's -- or another workspace's -- component.
create or replace function public.sitemap_sections_component_same_sitemap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.component_id is not null and not exists (
    select 1
    from public.sitemap_pages p
    join public.sitemap_components c on c.sitemap_id = p.sitemap_id
    where p.id = new.page_id
      and c.id = new.component_id
  ) then
    raise exception 'sitemap section component must belong to the same sitemap'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists sitemap_sections_component_same_sitemap on public.sitemap_sections;
create trigger sitemap_sections_component_same_sitemap
  before insert or update of component_id, page_id on public.sitemap_sections
  for each row
  execute function public.sitemap_sections_component_same_sitemap();

-- ---------------------------------------------------------------------
-- sitemap_shares
-- ---------------------------------------------------------------------

drop policy if exists sitemap_shares_select_member on public.sitemap_shares;
drop policy if exists sitemap_shares_insert_member on public.sitemap_shares;
drop policy if exists sitemap_shares_update_member on public.sitemap_shares;
drop policy if exists sitemap_shares_delete_member on public.sitemap_shares;

create policy sitemap_shares_select_team
  on public.sitemap_shares for select to authenticated
  using (public.can_read_sitemap(sitemap_id));

-- A new share must be born active: a pre-revoked row has no use and would
-- only muddy the one-active-share invariant.
create policy sitemap_shares_insert_team
  on public.sitemap_shares for insert to authenticated
  with check (public.can_write_sitemap(sitemap_id) and revoked_at is null);

-- Revoke only: the only legal update is setting revoked_at on an active
-- row (the trigger below makes every other change impossible).
create policy sitemap_shares_update_team
  on public.sitemap_shares for update to authenticated
  using (public.can_write_sitemap(sitemap_id) and revoked_at is null)
  with check (public.can_write_sitemap(sitemap_id) and revoked_at is not null);

-- No delete policy: revocation is the audit trail (revokeSitemapShare
-- never deletes; rows go with their sitemap via on delete cascade).

alter table public.sitemap_shares
  drop constraint if exists sitemap_shares_token_shape;
alter table public.sitemap_shares
  add constraint sitemap_shares_token_shape
  check (token ~ '^[A-Za-z0-9_-]{43,}$');

create unique index if not exists sitemap_shares_one_active_per_sitemap_idx
  on public.sitemap_shares (sitemap_id)
  where revoked_at is null;

create or replace function public.sitemap_shares_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.token is distinct from old.token
     or new.sitemap_id is distinct from old.sitemap_id
     or new.created_at is distinct from old.created_at
     or new.id is distinct from old.id then
    raise exception 'sitemap share token, sitemap and creation time are immutable'
      using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked sitemap share cannot be un-revoked'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists sitemap_shares_guard_update on public.sitemap_shares;
create trigger sitemap_shares_guard_update
  before update on public.sitemap_shares
  for each row
  execute function public.sitemap_shares_guard_update();
