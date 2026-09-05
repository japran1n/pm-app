-- F114 (docs/client-portal-phase-2-plan.md, items E-H): "How we work" —
-- one portal section, four kinds of client-facing writing (onboarding,
-- feedback, portal_guide, handover) built on the `docs`/`doc_kind`
-- vocabulary F022 already introduced (20261014010000), extended rather
-- than duplicated per this feature's own spec ("extend that vocabulary
-- rather than inventing a parallel system").
--
-- Two additions:
--   1. `docs_doc_kind_check` widened to also accept 'onboarding',
--      'feedback', 'portal_guide' (handover already existed —
--      the F022/F023 "Guides" list keeps filtering to `training`, so
--      widening the vocabulary here does not change what already renders
--      there).
--   2. `docs.relevant_from` — a nullable "when does this become
--      relevant" marker (kickoff / ongoing / launch) the section orders
--      by, against the project's own phase state, computed in
--      application code (lib/queries/how-we-work.ts). Null means
--      "always relevant" (feedback, portal_guide default here).
--   3. `doc_links` — manual title/description/thumbnail entries for
--      video and document previews (handover's own "how we work" note:
--      "if you cannot make [OG fetch] safe within this task, ship manual
--      fields instead and say so" — see this feature's handoff for the
--      explicit call). Scoped to one doc, RLS mirrors `page_links'`
--      shape (20261101020000): a link is client-readable only when its
--      own `client_visible` is true AND its parent doc is itself
--      client-visible, project-scoped, portal-enabled, and belongs to
--      the caller's own project.
--
-- Every SECURITY DEFINER predicate here (`is_project_visible_to`,
-- `is_project_client`, `is_project_portal_enabled`,
-- `is_project_workspace_writer`, `looks_like_credential`) already exists
-- and is already pinned to `public, pg_temp` (20260908010000,
-- 20261014020000) — nothing new to pin.

-- ---------------------------------------------------------------------
-- 1. doc_kind vocabulary: add onboarding / feedback / portal_guide
-- ---------------------------------------------------------------------

alter table docs
  drop constraint if exists docs_doc_kind_check,
  add constraint docs_doc_kind_check check (
    doc_kind in (
      'note', 'training', 'process', 'handover',
      'onboarding', 'feedback', 'portal_guide'
    )
  );

-- ---------------------------------------------------------------------
-- 2. docs.relevant_from — "when does this become relevant"
-- ---------------------------------------------------------------------

alter table docs
  add column if not exists relevant_from text;

alter table docs
  drop constraint if exists docs_relevant_from_check,
  add constraint docs_relevant_from_check check (
    relevant_from is null or relevant_from in ('kickoff', 'ongoing', 'launch')
  );

-- ---------------------------------------------------------------------
-- 3. doc_links — manual title/description/thumbnail preview rows
-- ---------------------------------------------------------------------

create table if not exists doc_links (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references docs (id) on delete cascade,
  url text not null,
  title text not null,
  description text,
  thumbnail_url text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doc_links_url_not_empty check (btrim(url) <> ''),
  constraint doc_links_title_not_empty check (btrim(title) <> ''),
  constraint doc_links_url_no_secret_shape check (not public.looks_like_credential(url)),
  constraint doc_links_description_no_secret_shape check (
    not public.looks_like_credential(description)
  )
);

create index if not exists doc_links_doc_id_position_idx
  on doc_links (doc_id, position);

drop trigger if exists doc_links_set_updated_at on doc_links;
create trigger doc_links_set_updated_at
  before update on doc_links
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 4. RLS: doc_links
-- ---------------------------------------------------------------------
-- Team read/write: any active workspace member who can read/write the
-- parent doc (mirrors docs' own `can_read_workspace_docs` /
-- `docs_update_active_members` posture, 20260905030000). Client read:
-- the parent doc must itself be client-visible, project-scoped, and the
-- caller must be that project's client with the portal enabled — same
-- shape as `docs_select_client` (20261014010000), joined through
-- doc_links.doc_id instead of duplicated inline.

alter table doc_links enable row level security;

drop policy if exists doc_links_select_team on doc_links;
create policy doc_links_select_team
  on doc_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from docs d
      where d.id = doc_links.doc_id
        and public.is_active_workspace_member(d.workspace_id)
        and public.can_read_workspace_docs(d.workspace_id)
    )
  );

drop policy if exists doc_links_select_client on doc_links;
create policy doc_links_select_client
  on doc_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from docs d
      where d.id = doc_links.doc_id
        and d.client_visible
        and d.project_id is not null
        and public.is_project_client(d.project_id)
        and public.is_project_visible_to(d.project_id)
        and public.is_project_portal_enabled(d.project_id)
    )
  );

drop policy if exists doc_links_insert_team on doc_links;
create policy doc_links_insert_team
  on doc_links
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from docs d
      where d.id = doc_links.doc_id
        and public.is_active_workspace_member(d.workspace_id)
        and public.can_read_workspace_docs(d.workspace_id)
    )
  );

drop policy if exists doc_links_update_team on doc_links;
create policy doc_links_update_team
  on doc_links
  for update
  to authenticated
  using (
    exists (
      select 1
      from docs d
      where d.id = doc_links.doc_id
        and public.is_active_workspace_member(d.workspace_id)
        and public.can_read_workspace_docs(d.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from docs d
      where d.id = doc_links.doc_id
        and public.is_active_workspace_member(d.workspace_id)
        and public.can_read_workspace_docs(d.workspace_id)
    )
  );

drop policy if exists doc_links_delete_team on doc_links;
create policy doc_links_delete_team
  on doc_links
  for delete
  to authenticated
  using (
    exists (
      select 1
      from docs d
      where d.id = doc_links.doc_id
        and public.is_active_workspace_member(d.workspace_id)
        and public.can_read_workspace_docs(d.workspace_id)
    )
  );
