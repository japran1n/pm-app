-- F005b (missions/20260903-portal): a stable key for the page task type.
--
-- F005's own getPortalPages matched the "page" task type with
-- `.ilike("name", "page")`, because task_types (20260903040000) is an
-- entirely workspace-owned taxonomy with no seeded rows to match on
-- instead. That worker documented the tradeoff honestly, but the
-- consequence is real: a workspace that names the type "Sida" or
-- "Stranica" gets an empty Pages view with no error, and renaming the
-- type later silently empties a client's view — the exact string-
-- matching failure mode F004 was forbidden to use for statuses.
--
-- Fix: `system_key`, a small closed set of stable identifiers a
-- workspace's own type ROW can optionally carry, independent of its
-- human-editable `name`. Nullable — most task types (Setup, Dev, Add-on,
-- ...) are pure workspace taxonomy and never need one.

alter table task_types add column if not exists system_key text;

alter table task_types drop constraint if exists task_types_system_key_check;
alter table task_types add constraint task_types_system_key_check
  check (system_key is null or system_key in ('page', 'qa', 'component', 'content', 'seo'));

-- A workspace may have at most one type carrying a given key — this is
-- what makes `system_key = 'page'` a safe unique lookup for
-- getPortalPages instead of a name match. Partial (where not null) so
-- ordinary untagged rows are unconstrained.
create unique index if not exists task_types_workspace_id_system_key_idx
  on task_types (workspace_id, system_key)
  where system_key is not null;

-- ---------------------------------------------------------------------
-- Backfill: any existing row already named "page" (case-insensitively)
-- keeps working without a manual re-tag. Safe against the new unique
-- index — task_types_workspace_id_name_idx already guarantees at most
-- one row per (workspace_id, name), so at most one row per workspace can
-- match this ILIKE.
-- ---------------------------------------------------------------------

update task_types
set system_key = 'page'
where system_key is null
  and name ilike 'page';

-- ---------------------------------------------------------------------
-- Seed on workspace creation.
--
-- task_types is workspace-scoped (unlike project_statuses, which is
-- seeded per PROJECT by the `seed_default_project_statuses_on_insert`
-- trigger, 20260824010000_project_statuses.sql lines 152-168 — a
-- project-creation hook, not a workspace one). Grepping every migration
-- under supabase/migrations for a workspace-level "defaults" seed found
-- none: `create_workspace_with_owner`
-- (20260817234323_workspace_create_rpc.sql, lines 43-77) is the one and
-- only path that creates a workspace, and until now it seeded just the
-- workspace row and the owner's membership row, both inside one
-- transaction. That IS "the path that creates a workspace's defaults"
-- for this schema, so the page type's seed insert is added to it,
-- following the same atomic-RPC convention this mission's own plan.md
-- requires for multi-table writes (`accept_client_request_atomic`,
-- `approve_portal_task_atomic`).
--
-- `on conflict do nothing` against the new partial unique index makes
-- this safe to no-op if ever re-run.
create or replace function public.create_workspace_with_owner(
  p_name text,
  p_slug text
)
returns table (id uuid, slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into workspaces (name, slug)
  values (p_name, p_slug)
  returning workspaces.id into v_workspace_id;

  insert into workspace_members (workspace_id, user_id, role, status)
  values (v_workspace_id, v_user_id, 'owner', 'active');

  insert into task_types (workspace_id, name, color, position, system_key)
  values (v_workspace_id, 'Page', '#3670e1', 0, 'page')
  on conflict (workspace_id, system_key) where system_key is not null do nothing;

  return query select v_workspace_id, p_slug;
end;
$$;

-- `set search_path = public, pg_temp` above additionally pins pg_temp
-- (20260908010000's lesson) on a function that previously only set
-- `public` — a caller-created pg_temp table could otherwise shadow
-- `workspaces`/`workspace_members`/`task_types` inside this SECURITY
-- DEFINER body.

revoke all on function public.create_workspace_with_owner(text, text) from public;
grant execute on function public.create_workspace_with_owner(text, text) to authenticated;
