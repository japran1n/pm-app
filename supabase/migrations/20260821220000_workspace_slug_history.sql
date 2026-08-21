-- F137 (AS-241, AS-242): workspace_slug_history — a record of every slug a
-- workspace previously had, so a URL built from an old slug can be
-- permanently redirected to the workspace's current slug instead of
-- 404ing.
--
-- `old_slug` is unique: a slug can only ever have belonged to one
-- workspace at a time (it was unique on `workspaces.slug` while live, per
-- that table's own existing unique constraint), so once retired it must
-- stay attached to that same workspace in history too — this is also what
-- lets AS-242's uniqueness check treat "is this slug taken" as a single
-- union of two tables, each individually unique on the column being
-- checked.
--
-- No expiry/TTL column and no cleanup job: per the clarified spec's
-- "simpler option that adds no new dependency and no second source of
-- truth", slugs are cheap and history rows are small, so retired slugs are
-- kept forever rather than introducing an expiry policy nothing in this
-- feature's assertions asks for.
create table public.workspace_slug_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  old_slug text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.workspace_slug_history is
  'F137: retired workspace slugs, so old URLs (/w/{old_slug}/...) permanently redirect to the workspace''s current slug instead of 404ing. Written by change_workspace_slug(); never updated or deleted.';

-- Main read path: "does this incoming slug match a retired one, and if so
-- which workspace does it now belong to" — the exact lookup the workspace
-- layout performs before falling through to notFound(). old_slug already
-- has a unique index (from the column constraint above) which serves this
-- equality lookup directly; no separate index needed.

-- Secondary read path: "history for workspace X", e.g. a future settings
-- view listing a workspace's past slugs.
create index workspace_slug_history_workspace_id_idx
  on public.workspace_slug_history (workspace_id);

alter table public.workspace_slug_history enable row level security;

-- SELECT: any authenticated user may resolve an old slug to its current
-- workspace. This mirrors the redirect's own purpose — the workspace
-- layout needs to answer "does this old slug belong to *some* workspace,
-- and which" for an arbitrary incoming URL, before it has established the
-- caller is a member of that workspace at all (that membership check
-- still happens, unchanged, against `workspaces` after the redirect).
-- No row here reveals anything beyond "this slug used to exist and now
-- points at workspace id X" — the same non-secret shape as a slug itself.
create policy workspace_slug_history_select_authenticated
  on public.workspace_slug_history
  for select
  to authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policy for any client role: rows are written
-- exclusively through the admin (service-role) client inside
-- `changeWorkspaceSlug` (lib/actions/workspaces.ts), inside the same
-- request that updates `workspaces.slug`, after the caller's owner/admin
-- membership has already been verified there. This mirrors every other
-- admin-client-only write path in this schema (e.g. workspace creation's
-- RPC, member removal's RPC) rather than opening a second, RLS-gated
-- write surface a caller's own session could hit directly.
