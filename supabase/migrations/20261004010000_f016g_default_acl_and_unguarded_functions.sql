-- F016g (missions/20260903-portal, M3 remediation — blocker, deferred
-- once already at M1/F006d): Supabase's per-role default privileges grant
-- EXECUTE on every function created in this schema to `anon` and
-- `authenticated`, independent of what that function's own migration
-- revokes from PUBLIC. A live audit of `pg_proc.proacl` (queried
-- directly against the linked project, not derived from the migration
-- files — see this feature's handoff for the query and full output)
-- confirms every one of the 100 functions in `public`, including every
-- SECURITY DEFINER function, is currently EXECUTE-able by both `anon`
-- and `authenticated`, regardless of that function's own
-- `revoke all ... from public` statement. Two of those are actively
-- dangerous: `sweep_overdue_blocking_deliverables` (SECURITY DEFINER,
-- zero authorisation, writes task statuses database-wide, meant to be a
-- pg_cron-only job) and `purge_task` (hard-deletes a trashed task in any
-- workspace, previously no internal authorisation check at all).
--
-- Fix, in order:
--   1. `alter default privileges ... revoke execute on functions from
--      anon, authenticated` — closes the hole for every function this
--      project creates from now on. Does NOT touch grants already
--      recorded on existing functions (Postgres default-privilege
--      changes are never retroactive).
--   2. A blanket `revoke execute on all functions in schema public from
--      anon, authenticated` closes the hole for every function that
--      already exists, undoing exactly the default-ACL grant this
--      feature is about — the same "revoke all, then grant back
--      deliberately" shape every migration in this schema already uses
--      for PUBLIC, just applied here to the two roles PUBLIC doesn't
--      cover.
--   3. Every function this migration's audit + a grep of
--      `supabase/migrations/` for `grant execute on function public.`
--      shows was DELIBERATELY exposed (the explicit-grant call surface)
--      gets that exact grant restored below, by name — including five
--      functions that turned out to be called directly via the user's
--      own `supabase.rpc(...)` session client
--      (`get_priority_counts`, `get_status_counts`,
--      `get_project_time_totals`, `get_workspace_time_by_person`,
--      `search_tasks`) but had NO explicit grant of their own anywhere in
--      this schema's migration history — they were relying entirely on
--      the default-ACL hole this migration closes, and would have broken
--      silently without this step. Confirmed by grep:
--      `grep -rhoE '\.rpc\('lib app` cross-referenced against
--      `grep -rhoE 'grant execute on function public\.' supabase/migrations`
--      (see handoff for the full two lists).
--   4. `purge_task` gets the same authorisation-mirrors-the-Server-Action
--      treatment F006n gave the five task RPCs
--      (20260921010000_f006n_unguarded_task_rpcs.sql): a direct
--      `authenticated`-role caller (auth.uid() is not null — the
--      admin/service_role call path from lib/actions/purge.ts is
--      untouched, exactly like every F006n function) must be an active,
--      `owner`-role member of the task's workspace, mirroring
--      `canPurge` (lib/auth/permissions.ts:132-134, `ctx.role ===
--      "owner"`) exactly.
--   5. `sweep_overdue_blocking_deliverables` keeps its existing
--      `postgres, service_role` grant (pg_cron on this project runs a
--      scheduled job as the role that called `cron.schedule` — this
--      migration and every prior cron-registering migration
--      (20260822160000, 20260823050000, this feature's own
--      20260927010000) all apply as `postgres` via the Management API,
--      so `postgres` is the correct — and only — role that needs to keep
--      running it). Step 2's blanket revoke is what actually closes the
--      hole here: the function's own migration already said
--      `grant ... to postgres, service_role` and never granted `anon`/
--      `authenticated` explicitly — it was exposed ONLY by the
--      default-ACL defect this migration fixes.

-- ---------------------------------------------------------------------
-- 1. Close the default for every function created from now on.
--
--    Applying just this against the live project and re-querying
--    `pg_proc`/`has_function_privilege` showed roughly half the
--    functions in `public` (every trigger function, plus several
--    RLS-predicate helpers whose own migration never issued a
--    `revoke ... from public` at all — e.g. `enforce_task_parent_rules`,
--    `handle_new_user`, `sync_task_status_and_status_id`) were STILL
--    reachable by `anon`/`authenticated` afterward. The reason: Postgres
--    grants EXECUTE to the pseudo-role `PUBLIC` automatically at
--    `CREATE FUNCTION` time unless a migration explicitly revokes it,
--    and `anon`/`authenticated` inherit through `PUBLIC` the same as any
--    other role — a role-scoped `revoke ... from anon, authenticated`
--    does not touch a `PUBLIC` grant. This mission's own migrations
--    mostly (not universally, as this audit found) already issue
--    `revoke all on function ... from public;` per function, which is
--    exactly why sweeping the schema found some already closed and some
--    not. `from public` below closes it for every function at once,
--    both the ones already covered per-migration and the ones that were
--    not.
-- ---------------------------------------------------------------------
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Close the default for every function that already exists — both
--    the per-role default-ACL grant (anon, authenticated) this
--    feature's audit found on every existing function, AND the
--    `PUBLIC` grant that a handful of functions were never explicitly
--    stripped of by their own migration (see step 1's comment).
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Restore every deliberate grant, by name, using each function's own
--    live signature (handles overloads like cascade_delete_task and
--    create_channel_atomic without hand-typing every argument list).
-- ---------------------------------------------------------------------
do $$
declare
  fn record;
  -- Functions with at least one existing `grant execute ... to
  -- authenticated` statement in this schema's own migration history
  -- (grep evidence, see this migration's header comment), PLUS the five
  -- functions proven to be called via the user's own `supabase.rpc(...)`
  -- session client with no explicit grant of their own.
  authenticated_fns text[] := array[
    'accept_client_request_atomic',
    'accept_deliverable_atomic',
    'apply_status_template',
    'approve_portal_task_atomic',
    'bulk_delete_tasks_atomic',
    'can_modify_comment',
    'can_read_workspace_docs',
    'can_write_workspace_docs',
    'change_workspace_slug_atomic',
    'client_gate',
    'create_channel_atomic',
    'create_notification',
    'create_workspace_with_owner',
    'decide_approval_atomic',
    'derive_project_key_base',
    'duplicate_task_atomic',
    'flag_assumption_atomic',
    'generate_unique_project_key',
    'get_blocked_count',
    'get_chat_channel_summaries',
    'get_completed_count',
    'get_due_soon_count',
    'get_open_task_counts',
    'get_overdue_count',
    'get_project_board_tasks',
    'is_active_workspace_member',
    'is_done_status',
    'is_project_decision_owner',
    'is_project_lead_or_workspace_admin',
    'is_project_visible_to',
    'is_project_visible_to_row',
    'is_project_workspace_admin',
    'is_project_workspace_member',
    'is_project_workspace_writer',
    'is_task_visible_to',
    'is_task_workspace_member',
    'is_task_workspace_writer',
    'is_workspace_admin',
    -- Not previously granted at all (relied entirely on the default-ACL
    -- hole this migration closes) but invoked from WITHIN RLS policy
    -- expressions on several tables (confirmed by querying
    -- `pg_policies.qual`/`with_check` directly against the live
    -- project — see this migration's handoff), which are evaluated as
    -- the QUERYING role, not the policy owner. Without an explicit
    -- grant, revoking the default-ACL hole broke every RLS-protected
    -- query that reaches one of these predicates for an ordinary
    -- `authenticated` session — caught by re-running
    -- tests/integration/status-counts-rpc.test.ts,
    -- trash-exclusion-dashboard.test.ts, trash-exclusion-search.test.ts,
    -- and workspace-time-by-person.test.ts, all of which failed with
    -- "permission denied for function is_project_client" until this was
    -- added.
    'is_project_client',
    'is_task_client',
    'is_workspace_client',
    'shares_non_client_workspace_with',
    'is_project_portal_enabled',
    'mark_deliverable_delivered_atomic',
    'raise_change_request_from_assumption_atomic',
    'remove_workspace_member',
    'request_portal_task_changes_atomic',
    'restore_task_atomic',
    'seed_default_phases',
    'send_change_request_quote_atomic',
    'set_task_assignees_atomic',
    'shares_workspace_with',
    'start_timer_atomic',
    'stop_timer_atomic',
    'transfer_workspace_ownership',
    'write_audit_log_entry',
    'write_task_activity_entry',
    -- Called directly via supabase.rpc() from the caller's own session
    -- (grep: lib/queries/dashboard.ts, lib/queries/time-entries.ts,
    -- lib/queries/search.ts) but never explicitly granted before this
    -- migration — see header comment, step 3.
    'get_priority_counts',
    'get_status_counts',
    'get_project_time_totals',
    'get_workspace_time_by_person',
    'search_tasks',
    -- Not SECURITY DEFINER, no `.rpc()` call site, and no explicit grant
    -- anywhere — but used inside a table CHECK constraint
    -- (`profiles_timezone_valid`, 20260818225500), which Postgres
    -- evaluates as the QUERYING role on every INSERT/UPDATE of
    -- `profiles.timezone`, not the table owner. Caught by re-running
    -- tests/integration/rls-profiles.test.ts, which failed with
    -- "permission denied for function is_valid_timezone" until this was
    -- added (grep confirmed: `grep -rn "check (public\." supabase/
    -- migrations/*.sql` for every function-backed CHECK constraint in
    -- this schema, the rest already covered above via
    -- is_project_workspace_writer / is_active_workspace_member /
    -- can_modify_comment).
    'is_valid_timezone'
  ];
  -- Functions whose existing grant history also includes `anon`
  -- (RLS-predicate helpers callable from an unauthenticated PostgREST
  -- session so their own table's RLS policy — which calls them
  -- internally — does not raise "permission denied for function" for an
  -- anon query, plus the two data helpers already granted to anon).
  anon_fns text[] := array[
    'can_modify_comment',
    'derive_project_key_base',
    'generate_unique_project_key',
    'get_blocked_count',
    'get_completed_count',
    'get_due_soon_count',
    'get_overdue_count',
    'is_active_workspace_member',
    'is_done_status',
    'is_project_lead_or_workspace_admin',
    'is_project_visible_to',
    'is_project_visible_to_row',
    'is_project_workspace_admin',
    'is_project_workspace_member',
    'is_project_workspace_writer',
    'is_task_visible_to',
    'is_task_workspace_member',
    'is_task_workspace_writer',
    'is_workspace_admin',
    'shares_workspace_with',
    'is_project_client',
    'is_task_client',
    'is_workspace_client',
    'shares_non_client_workspace_with',
    'is_project_portal_enabled'
  ];
  -- service_role-only functions besides the two Postgres explicitly
  -- calls out (purge_task/purge_comment, cascade_delete_task): the
  -- default-ACL grant to anon/authenticated is what step 2 revokes here;
  -- these get NO authenticated/anon grant restored, deliberately.
begin
  for fn in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(authenticated_fns)
  loop
    execute format('grant execute on function public.%I(%s) to authenticated', fn.proname, fn.args);
  end loop;

  for fn in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(anon_fns)
  loop
    execute format('grant execute on function public.%I(%s) to anon', fn.proname, fn.args);
  end loop;
end $$;

-- service_role keeps everything it already had — step 2's blanket revoke
-- only named anon/authenticated, so no service_role grant needs restoring.

-- ---------------------------------------------------------------------
-- 4. purge_task: real authorisation, mirroring purgeTrashItem's own
--    `canPurge` check (lib/auth/permissions.ts:132-134 — owner only),
--    same shape as F006n's `if auth.uid() is not null then ... end if`
--    (20260921010000): the admin/service_role call path from
--    lib/actions/purge.ts (already re-checked there) is untouched; a
--    direct `authenticated`-role caller is now rejected unless they are
--    an active `owner` of the task's workspace.
-- ---------------------------------------------------------------------
create or replace function public.purge_task(p_task_id uuid)
returns table (
  id uuid,
  attachment_paths text[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_at timestamptz;
  v_paths text[];
  v_workspace_id uuid;
  v_caller_role text;
begin
  if auth.uid() is not null then
    select p.workspace_id
      into v_workspace_id
      from tasks t
      join projects p on p.id = t.project_id
     where t.id = p_task_id;

    if v_workspace_id is null then
      raise exception 'purge_task: task % is not in the trash (not soft-deleted) or does not exist', p_task_id
        using errcode = '42501';
    end if;

    select wm.role into v_caller_role
      from workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = auth.uid()
       and wm.status = 'active';

    if v_caller_role is null or v_caller_role <> 'owner' then
      raise exception 'purge_task: only a workspace owner can permanently delete this item'
        using errcode = '42501';
    end if;
  end if;

  select t.deleted_at into v_deleted_at
  from tasks t
  where t.id = p_task_id
  for update;

  if v_deleted_at is null then
    raise exception 'purge_task: task % is not in the trash (not soft-deleted) or does not exist', p_task_id;
  end if;

  select coalesce(array_agg(a.file_url), array[]::text[])
    into v_paths
  from attachments a
  where a.task_id = p_task_id;

  delete from checklist_items where task_id = p_task_id;
  delete from comments where task_id = p_task_id;
  delete from active_timers where task_id = p_task_id;
  delete from time_entries where task_id = p_task_id;
  delete from attachments where task_id = p_task_id;

  delete from task_dependencies
    where blocking_task_id = p_task_id or blocked_task_id = p_task_id;
  delete from task_assignees where task_id = p_task_id;
  delete from task_watchers where task_id = p_task_id;

  update tasks set parent_task_id = null where parent_task_id = p_task_id;
  update tasks set deleted_via_task_id = null where deleted_via_task_id = p_task_id;

  delete from tasks where tasks.id = p_task_id;

  return query select p_task_id, v_paths;
end;
$$;

revoke all on function public.purge_task(uuid) from public;
revoke all on function public.purge_task(uuid) from anon, authenticated;
grant execute on function public.purge_task(uuid) to service_role;
