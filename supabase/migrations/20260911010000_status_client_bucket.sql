-- F004 (missions/20260903-portal, M1): status vocabulary -- the client
-- bucket a project status tints/groups as in the portal (AS-015, AS-016).
--
-- `project_statuses.category` only carries three values
-- (not_started | in_progress | done) and cannot express "waiting on the
-- client" -- that distinction is exactly what a status like "Awaiting
-- Client Feedback" (category `in_progress`, per
-- docs/team-app-for-portal-plan.md's status table) or "Blocked"
-- (no `blocked` category exists at all) needs. Rather than a parallel
-- status table or a hard-coded name lookup, this migration adds ONE
-- nullable column checked against the four client-facing buckets. A null
-- value falls back to a category-derived default, applied in application
-- code (components/portal/status-label.ts's `resolveClientBucket`) --
-- never by matching a status's name string.
--
-- Additive and backwards compatible: every existing status keeps
-- `client_bucket` null and keeps resolving via its `category` exactly as
-- it does today, until a PM explicitly picks a bucket for it in the
-- board-columns settings screen (F004's UI half).

alter table project_statuses add column if not exists client_bucket text;

alter table project_statuses drop constraint if exists project_statuses_client_bucket_check;
alter table project_statuses add constraint project_statuses_client_bucket_check
  check (client_bucket is null or client_bucket in ('waiting', 'progress', 'blocked', 'done'));

-- ---------------------------------------------------------------------
-- Seed sensible client-facing descriptions for the four default board
-- columns every new project gets
-- (`seed_default_project_statuses`, most recently redefined by
-- 20260828030000_status_rename_sync_and_seed_colors.sql, whose seed
-- colours this migration preserves verbatim -- see that migration's own
-- comment for why they are `#64748b`/`#3b82f6`/`#d97706`/`#16a34a` and
-- not 20260824010000's original hexes) -- AS-016 requires a real,
-- database-sourced description to exist somewhere; a fresh project's
-- default board is the one place this feature can seed one without
-- guessing at a specific team's real vocabulary. None of the four needs
-- a `client_bucket` override: `todo` (category `not_started`) and `done`
-- (category `done`) already fall back correctly, and `in_progress`/
-- `in_review` both read fine as "In progress" without a client seeing
-- the team's internal QA/review split. `client_bucket` is left null on
-- all four, deliberately exercising the category fallback rather than
-- hard-coding it here too.
--
-- Re-created with the same signature (`create or replace`, not a
-- disruptive drop+create) -- this is a body-only change, and per this
-- migration file's own header, `set search_path = public, pg_temp`
-- replaces the function's prior unqualified `set search_path = public`,
-- closing the same implicit-pg_temp-shadowing gap
-- 20260908010000_pin_pg_temp_on_client_visibility_predicates.sql closed
-- for the client-visibility predicates (this function is SECURITY
-- DEFINER too, so the same risk applies even though it isn't itself a
-- visibility predicate).
create or replace function public.seed_default_project_statuses(target_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into project_statuses (project_id, name, color, category, position, client_description)
  values
    (target_project_id, 'todo', '#64748b', 'not_started', 1000, 'Planned. Work has not started yet.'),
    (target_project_id, 'in_progress', '#3b82f6', 'in_progress', 2000, 'The team is actively working on this.'),
    (target_project_id, 'in_review', '#d97706', 'in_progress', 3000, 'The team is reviewing this before it moves forward.'),
    (target_project_id, 'done', '#16a34a', 'done', 4000, 'Delivered.')
  on conflict (project_id, name) do nothing;
end;
$$;

revoke all on function public.seed_default_project_statuses(uuid) from public;
grant execute on function public.seed_default_project_statuses(uuid) to service_role;
