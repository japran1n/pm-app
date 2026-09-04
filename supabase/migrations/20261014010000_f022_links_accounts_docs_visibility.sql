-- F022 (missions/20260903-portal, M5 — Site, guides, trust): the site
-- inventory (`project_links`), the account handover ledger
-- (`project_accounts`), and a client-visible read path on `docs` for the
-- portal's guides list (AS-049, AS-050, AS-051).
--
-- Every SECURITY DEFINER predicate this migration relies on is one of
-- the existing helpers (`is_project_visible_to`, `is_project_client`,
-- `is_project_portal_enabled`, `is_project_workspace_writer`) pinned to
-- `public, pg_temp` since 20260908010000 — this migration adds no new
-- SECURITY DEFINER function, so there is nothing new to re-pin.
--
-- `project_links.client_visible` defaults FALSE: a link added in a hurry
-- must not reach the client because someone forgot a toggle.
-- `project_accounts.client_visible` defaults TRUE: this table exists to
-- answer "what do I actually own", the question every client asks at
-- handover, so hiding a row is the deliberate exception, not the rule.

-- ---------------------------------------------------------------------
-- 0. Shared secret-shape guard
-- ---------------------------------------------------------------------
-- Deliberately imperfect: a CHECK plus a matching Zod refinement (see
-- lib/validation/project-accounts.ts) that rejects the shapes a
-- password/API key most commonly takes -- a long base64-ish run, `sk_`,
-- `pk_`, `ghp_`, `xox`, `-----BEGIN`. This does not stop a determined
-- typist (there is no way to do that from a CHECK constraint) and is not
-- meant to; it stops the tired one who was about to paste a credential
-- into a plain-text field the client portal renders. One shared function
-- so the CHECK and this migration's own comment describe exactly one
-- rule, not two that can drift apart.
create or replace function public.looks_like_credential(value text)
returns boolean
language sql
immutable
as $$
  select value is not null and (
    value ~ '(?i)sk_[a-z0-9_]{10,}'
    or value ~ '(?i)pk_[a-z0-9_]{10,}'
    or value ~ '(?i)ghp_[a-z0-9_]{10,}'
    or value ~ '(?i)xox[a-z]-[a-z0-9-]{10,}'
    or value ~ '-----BEGIN'
    or value ~ '[A-Za-z0-9+/]{40,}={0,2}'
  );
$$;

-- ---------------------------------------------------------------------
-- 1. project_links
-- ---------------------------------------------------------------------

create table if not exists project_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null,
  label text not null,
  url text not null,
  client_visible boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_links_label_not_empty check (btrim(label) <> ''),
  constraint project_links_url_not_empty check (btrim(url) <> ''),
  constraint project_links_kind_check check (
    kind in (
      'staging', 'live', 'figma', 'sitemap', 'drive', 'webflow',
      'gtm', 'analytics', 'search_console', 'other'
    )
  )
);

create index if not exists project_links_project_id_position_idx
  on project_links (project_id, position);

drop trigger if exists project_links_set_updated_at on project_links;
create trigger project_links_set_updated_at
  before update on project_links
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 2. project_accounts
-- ---------------------------------------------------------------------
-- No credential fields, ever. `service` and `note` are the only free-text
-- columns on this table (the spec's own "label" reference does not name
-- an actual column here -- `project_accounts` has no `label` column,
-- unlike `project_links` -- so the guard is applied to the two columns
-- that actually exist: `service`, the free-text account/tool name, and
-- `note`, the free-text handover note).

create table if not exists project_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  service text not null,
  owner text not null,
  status text not null,
  renewal_date date,
  note text,
  client_visible boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_accounts_service_not_empty check (btrim(service) <> ''),
  constraint project_accounts_owner_check check (owner in ('client', 'agency')),
  constraint project_accounts_status_check check (
    status in ('pending', 'provisioned', 'transferred')
  ),
  constraint project_accounts_service_no_secret_shape check (
    not public.looks_like_credential(service)
  ),
  constraint project_accounts_note_no_secret_shape check (
    not public.looks_like_credential(note)
  )
);

create index if not exists project_accounts_project_id_position_idx
  on project_accounts (project_id, position);

drop trigger if exists project_accounts_set_updated_at on project_accounts;
create trigger project_accounts_set_updated_at
  before update on project_accounts
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. docs: client_visible, doc_kind
-- ---------------------------------------------------------------------

alter table docs
  add column if not exists client_visible boolean not null default false,
  add column if not exists doc_kind text not null default 'note';

alter table docs
  drop constraint if exists docs_doc_kind_check,
  add constraint docs_doc_kind_check check (
    doc_kind in ('note', 'training', 'process', 'handover')
  );

-- ---------------------------------------------------------------------
-- 4. RLS: project_links
-- ---------------------------------------------------------------------
-- Same shape as F012's client_deliverables/project_decisions: team SELECT
-- is "visible to me and I'm not a client"; client SELECT additionally
-- requires portal_enabled AND client_visible (unlike client_deliverables,
-- a link is NOT inherently client-facing -- a staging URL with basic-auth
-- baked in is exactly the kind of row that must stay internal by
-- default). Every write is a team write.

alter table project_links enable row level security;

drop policy if exists project_links_select_team on project_links;
create policy project_links_select_team
  on project_links
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_links_select_client on project_links;
create policy project_links_select_client
  on project_links
  for select
  to authenticated
  using (
    client_visible
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_links_insert_team on project_links;
create policy project_links_insert_team
  on project_links
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_links_update_team on project_links;
create policy project_links_update_team
  on project_links
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_links_delete_team on project_links;
create policy project_links_delete_team
  on project_links
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 5. RLS: project_accounts
-- ---------------------------------------------------------------------
-- Same shape, `client_visible` conjunct still required on the client
-- policy even though the column defaults true -- a PM can still hide a
-- specific account (e.g. an internal monitoring tool billed through the
-- agency that the client never needs to see), and RLS must honour that
-- the moment it's flipped, default or not.

alter table project_accounts enable row level security;

drop policy if exists project_accounts_select_team on project_accounts;
create policy project_accounts_select_team
  on project_accounts
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_accounts_select_client on project_accounts;
create policy project_accounts_select_client
  on project_accounts
  for select
  to authenticated
  using (
    client_visible
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_accounts_insert_team on project_accounts;
create policy project_accounts_insert_team
  on project_accounts
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_accounts_update_team on project_accounts;
create policy project_accounts_update_team
  on project_accounts
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_accounts_delete_team on project_accounts;
create policy project_accounts_delete_team
  on project_accounts
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 6. RLS: docs -- ADD a client read path, do not touch team policies
-- ---------------------------------------------------------------------
-- 20260905020000/20260905030000 closed a real leak on `docs_select_
-- active_members`/`doc_folders_select_active_members` by requiring
-- `can_read_workspace_docs`, which itself excludes the `client` role.
-- Those policies -- and every other existing docs policy -- are left
-- completely unchanged below (not one line of 20260905020000/
-- 20260905030000 is dropped or redefined). This migration only ADDS one
-- new, additional permissive SELECT policy scoped to the `client` role:
-- a project-scoped, portal-enabled, client_visible doc. RLS policies for
-- the same command are OR'd together, so this purely widens what a
-- `client`-role caller can read from "nothing" to "exactly this," while
-- every non-client caller's access is governed entirely by the
-- pre-existing, unmodified policies.

drop policy if exists docs_select_client on docs;
create policy docs_select_client
  on docs
  for select
  to authenticated
  using (
    client_visible
    and project_id is not null
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );
