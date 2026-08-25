-- F263 (AS-510): project_favorites -- lets a user pin a project above the
-- rest of their own sidebar project list. Additive-only (new table, no
-- change to any existing table/column), per this mission's standing
-- "additive first" migration-safety rule.
--
-- Shape (Clarified implementation / spec draft scope): (user_id,
-- project_id, created_at), composite primary key on (user_id, project_id)
-- -- a user can favourite a given project at most once, and the PK alone
-- gives idempotent "toggle" semantics an upsert/delete can rely on without
-- a separate uniqueness index.
--
-- RLS (spec draft scope: "own-row RLS, not project-scoped"): a user may
-- only select/insert/delete rows where user_id = auth.uid(). This is
-- deliberately NOT gated on `is_project_visible_to(project_id)` at the RLS
-- layer -- the spec explicitly calls this "an own-row policy, not
-- project-scoped". The read side still must not leak a project the caller
-- can no longer see (e.g. removed from a private project after
-- favouriting it, or the project was archived/soft-deleted): rather than
-- encode that in RLS (which would make an orphaned favorite silently
-- undeletable/unreadable, complicating the toggle-off path for exactly the
-- row a user most wants to clean up), the READ QUERY
-- (lib/queries/projects.ts's getFavoriteProjectIds, called from the
-- workspace layout) joins against the same RLS-scoped `projects` select
-- the sidebar already uses, so a favorite for a since-hidden project is
-- naturally absent from what's returned for pinning, while the row itself
-- remains toggleable (still deletable) via the favorites table's own
-- simple own-row policy. This mirrors this migration's sibling
-- board_swimlane_prefs' own "self-scoped, no admin client, no second
-- source of truth for visibility" convention.
create table if not exists public.project_favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

comment on table public.project_favorites is
  'F263 (AS-510): a user''s favourited/pinned projects. Own-row RLS only -- the read query additionally filters through the RLS-scoped projects list so an orphaned favourite for a no-longer-visible project never renders, while remaining toggleable.';

-- Performance budget (Clarified implementation #8): the sidebar/layout
-- read is "all of THIS user's favorite project ids" -- a single index on
-- user_id covers it; project_id is already indexed via the PK's leading
-- column order not helping project_id lookups alone, but no code path in
-- this feature queries by project_id alone, so no second index is added.
create index if not exists project_favorites_user_id_idx
  on public.project_favorites (user_id);

alter table public.project_favorites enable row level security;

drop policy if exists project_favorites_select_own on public.project_favorites;
create policy project_favorites_select_own
  on public.project_favorites
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists project_favorites_insert_own on public.project_favorites;
create policy project_favorites_insert_own
  on public.project_favorites
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists project_favorites_delete_own on public.project_favorites;
create policy project_favorites_delete_own
  on public.project_favorites
  for delete
  to authenticated
  using (user_id = auth.uid());

-- No update policy: a favorite is a boolean membership fact (favourited or
-- not) -- there is nothing on this row a user would ever update in place,
-- only insert (favourite) or delete (unfavourite). No policy for anon:
-- absence of a matching policy denies access by default under RLS,
-- matching this repo's established convention.
