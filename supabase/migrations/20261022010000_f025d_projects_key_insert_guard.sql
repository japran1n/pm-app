-- F025d (missions/20260903-portal, final remediation — blocker): the
-- same bug F025c fixed on the UPDATE-adjacent task_counter write, now
-- on the INSERT side, for `projects.key`.
--
-- ---------------------------------------------------------------------
-- Defect: projects_assign_key vs. the allow-list guard, on INSERT.
--
-- `assign_project_key()` (20260819061129, sentinel-default behaviour
-- added by 20260819061442:33-45) is a BEFORE INSERT trigger
-- (`projects_assign_key`, 20260819061129:196-200) that writes
-- `NEW.key` whenever it is null or the schema's sentinel default `''`
-- (`alter column key set default ''`, 20260819061442:26-27).
-- `key` is not named in any of `enforce_projects_field_role_allowlist`'s
-- four tiers (`v_identity_cols`/`v_member_cols`/`v_writer_cols`/
-- `v_owner_admin_cols`, 20261017010000/20261019010000), so on INSERT it
-- falls into the same generic "any other column must still match its
-- own schema default" branch that caught `task_counter` in F025c.
--
-- Postgres fires same-timing BEFORE INSERT row triggers on one table in
-- trigger-name alphabetical order: `projects_assign_key` < `projects_
-- enforce_field_role_allowlist`, so by the time the guard runs, `NEW.key`
-- already holds a real generated key, distinct from the column's `''`
-- default, and the guard raises `42501` for EVERY project insert made
-- by an authenticated (non-service_role) session — exactly the session
-- `projects_insert_active_members` (20260818004413) grants to every
-- active workspace member.
--
-- Why nobody noticed: the shipped product path
-- (`lib/actions/projects.ts:124`, `createProject`) inserts with the
-- service-role admin client, which the guard's first branch already
-- exempts, so the defect never fires in the running app. And the only
-- existing INSERT-side test in `tests/integration/
-- f020b-projects-allowlist-guard.test.ts` (the `baseline_frozen_at`
-- INSERT-hole test, ~line 229) asserts only `expect(error).not.toBeNull()`
-- for a client inserting `baseline_frozen_at` alongside `name`/
-- `workspace_id` -- it passes whether the error is the intended
-- baseline-column rejection or this defect's key-column rejection,
-- because BOTH land on the exact same generic "not an allow-listed
-- column" exception, indistinguishable by pass/fail alone. No test
-- anywhere performs a clean authenticated project INSERT (every
-- fixture project in every test suite is created with the admin
-- client), so nothing ever hit the case where key IS the only
-- discrepancy and the insert should succeed.
--
-- ---------------------------------------------------------------------
-- Fix: port F025c's bypass-flag technique, not a new allow-list entry.
--
-- Unlike `assign_task_number()` (F025c), `assign_project_key()` does
-- not perform a separate UPDATE that re-enters this same trigger from
-- the outside -- it writes `NEW.key` directly, inside the same BEFORE
-- INSERT trigger chain the guard trigger is also part of, on the SAME
-- row, in the SAME statement. So the on/off bracket cannot live
-- entirely inside `assign_project_key()`'s own body the way F025c's
-- bracket lives entirely inside `assign_task_number()`'s body around
-- its own UPDATE -- `assign_project_key()` runs and returns BEFORE
-- `enforce_projects_field_role_allowlist` (the guard) even starts, so a
-- flag turned back "off" before `assign_project_key()` returns would
-- already be off by the time the guard reads it.
--
-- Instead, `assign_project_key()` turns the flag "on" (transaction-
-- local, `set_config(..., true)`, exactly like F025c's) and leaves it
-- on; the guard consumes it itself, in its own existing bypass check at
-- the top of `enforce_projects_field_role_allowlist`, by immediately
-- turning the flag back "off" the moment it observes it "on". This is
-- deliberate, not a shortcut: leaving the flag "on" after
-- `assign_project_key()` returns, with nothing to turn it back off
-- before the guard trigger fires next (same statement, immediately
-- after, by name order), would otherwise leak the bypass into any later
-- statement in the same transaction (`is_local = true` only reverts the
-- GUC at transaction end, not at end of statement). Self-consuming the
-- flag inside the guard's own check closes that window to exactly the
-- one guard invocation that follows the trigger which set it, whether
-- that invocation was reached via `assign_project_key()` (INSERT, this
-- fix) or via `assign_task_number()`'s own explicit on/off bracket
-- around its separate UPDATE (F025c, unaffected: that bracket still
-- turns the flag "off" itself immediately after its UPDATE returns, so
-- the guard's own self-consuming reset there is redundant but harmless
-- -- `set_config('off')` when already "off" is a no-op).
--
-- Critically, unlike `assign_task_number()`'s bypass (a separate
-- statement, on a different row, that legitimately skips the WHOLE
-- guard for that one UPDATE), `assign_project_key()`'s bypass fires
-- INSIDE the same INSERT statement whose other columns (e.g.
-- `baseline_frozen_at`, `portal_enabled`) still need checking on this
-- exact row. An early `return new` here would have skipped ALL of the
-- guard's checks for the whole row, not just the `key` comparison --
-- verified by writing the client-baseline_frozen_at-on-INSERT
-- regression test first and watching it go from "rejected for the
-- wrong reason" (pre-fix) to "wrongly accepted" (an early `return new`)
-- before landing on the fix below. So the flag does not short-circuit
-- the function at all: it only adds `key` to the identity-column set
-- for the one INSERT it was set for, so the diff loop no longer flags
-- `key` while every other column, and the writer/owner-admin checks,
-- still run exactly as before.
--
-- Not fixed by adding `key` to `v_identity_cols` unconditionally either
-- (the naive equivalent of an allow-list entry): that would let a
-- CALLER-supplied `key` through unexamined too, on every insert, not
-- only the trigger-generated one. Scoping the exemption to the
-- transaction-local flag keeps a caller-supplied `key` (the case where
-- `assign_project_key()` sees a non-empty value and never sets the
-- flag) rejected exactly as before.
-- ---------------------------------------------------------------------

create or replace function public.enforce_projects_field_role_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_cols constant text[] := array['id', 'workspace_id', 'created_at', 'updated_at', 'created_by'];
  v_member_cols constant text[] := array['name', 'description', 'start_date', 'end_date'];
  v_writer_cols constant text[] := array['target_launch_date', 'launch_confidence', 'launch_note', 'warranty_until', 'warranty_terms', 'baseline_frozen_at'];
  v_owner_admin_cols constant text[] := array['portal_enabled', 'portal_enabled_at', 'visibility', 'deleted_at', 'archived_by'];
  v_named_cols text[];
  v_is_writer boolean;
  v_is_owner_admin boolean;
  v_default_cols text;
  v_default_row public.projects;
  v_new_diff jsonb;
  v_ref_diff jsonb;
  v_key text;
  v_col text;
  v_writer_touched boolean := false;
  v_owner_admin_touched boolean := false;
  v_key_bypass boolean := false;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- F025c/F025d: transaction-local bypass for the application's own
  -- SECURITY DEFINER trigger writes -- assign_task_number()'s
  -- task_counter bump (F025c, a separate UPDATE statement that
  -- legitimately skips this WHOLE guard for that one write) and
  -- assign_project_key()'s key generation (F025d, INSIDE this same
  -- INSERT statement, where every other column still needs checking on
  -- this row) -- matching F016j's client_requests_triage_guard_bypass
  -- technique. Never settable by a caller through RLS/PostgREST -- only
  -- a SECURITY DEFINER function body running server-side can call
  -- set_config with this name, and `true` (transaction-local) means it
  -- cannot leak past the enclosing transaction's commit/rollback.
  --
  -- The flag is self-consumed HERE (turned back "off" the instant it is
  -- observed "on"), not only by the writer that set it, because
  -- assign_project_key() (BEFORE INSERT, same row, same statement) has
  -- no later statement of its own in which to turn the flag back off
  -- before this guard trigger runs next in name order -- unlike
  -- assign_task_number()'s own separate UPDATE, which re-enters this
  -- guard from outside and can bracket it itself (that bracket's own
  -- "off" afterward becomes a harmless no-op here).
  --
  -- F025d: the two legitimate setters of this flag are told apart by
  -- TG_OP, which is safe because each only ever fires the operation
  -- named here -- assign_task_number() sets the flag around its own
  -- UPDATE on projects (this guard's TG_OP = 'UPDATE' branch) and
  -- assign_project_key() sets it inside a BEFORE INSERT trigger on
  -- projects (TG_OP = 'INSERT'):
  --   - TG_OP = 'UPDATE': an early `return new` is correct and
  --     unchanged from F025c -- assign_task_number()'s write is a
  --     wholly separate statement re-entering this guard from outside,
  --     and no other column of the row it targets is being changed by
  --     that statement, so skipping the whole guard for it is safe.
  --   - TG_OP = 'INSERT': recorded into v_key_bypass instead, because
  --     assign_project_key()'s write shares this exact row and
  --     statement with every other column the guard still must check
  --     (a client inserting `baseline_frozen_at` alongside a project
  --     with no explicit `key` still needs to be rejected) -- an early
  --     `return new` here was tried and rejected during this fix; see
  --     this migration's own header for why.
  if coalesce(current_setting('app.projects_field_guard_bypass', true), 'off') = 'on' then
    perform set_config('app.projects_field_guard_bypass', 'off', true);
    if TG_OP = 'UPDATE' then
      return new;
    end if;
    v_key_bypass := true;
  end if;

  v_named_cols := v_identity_cols || v_member_cols || v_writer_cols || v_owner_admin_cols;
  if v_key_bypass then
    v_named_cols := v_named_cols || array['key'];
  end if;

  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role not in ('viewer', 'client')
  ) into v_is_writer;

  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  ) into v_is_owner_admin;

  if TG_OP = 'INSERT' then
    select string_agg(
             coalesce(pg_get_expr(ad.adbin, ad.adrelid), 'NULL') || ' as ' || quote_ident(a.attname),
             ', '
           )
      into v_default_cols
      from pg_attribute a
      left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
     where a.attrelid = 'public.projects'::regclass
       and a.attnum > 0
       and not a.attisdropped;

    execute 'select ' || v_default_cols into v_default_row;

    v_new_diff := to_jsonb(new) - v_named_cols;
    v_ref_diff := to_jsonb(v_default_row) - v_named_cols;

    for v_key in select jsonb_object_keys(v_new_diff)
    loop
      if (v_new_diff -> v_key) is distinct from (v_ref_diff -> v_key) then
        raise exception 'projects: a project cannot be created already carrying a value for % (not an allow-listed column)', v_key
          using errcode = '42501';
      end if;
    end loop;

    foreach v_col in array v_writer_cols
    loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(v_default_row) -> v_col) then
        v_writer_touched := true;
      end if;
    end loop;

    foreach v_col in array v_owner_admin_cols
    loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(v_default_row) -> v_col) then
        v_owner_admin_touched := true;
      end if;
    end loop;
  else
    v_new_diff := to_jsonb(new) - v_named_cols;
    v_ref_diff := to_jsonb(old) - v_named_cols;

    for v_key in select jsonb_object_keys(v_new_diff)
    loop
      if (v_new_diff -> v_key) is distinct from (v_ref_diff -> v_key) then
        raise exception 'projects: % cannot be changed directly (not an allow-listed column)', v_key
          using errcode = '42501';
      end if;
    end loop;

    foreach v_col in array v_writer_cols
    loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
        v_writer_touched := true;
      end if;
    end loop;

    foreach v_col in array v_owner_admin_cols
    loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
        v_owner_admin_touched := true;
      end if;
    end loop;
  end if;

  if v_writer_touched and not v_is_writer then
    raise exception 'Only workspace members with write access can change a project''s launch, warranty or baseline-freeze fields'
      using errcode = '42501';
  end if;

  if v_owner_admin_touched and not v_is_owner_admin then
    raise exception 'Only workspace owners or admins can change a project''s portal, visibility or archive fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_projects_field_role_allowlist() is
  'F006k/F020b/F025c/F025d: allow-list guard on projects, BEFORE INSERT OR UPDATE. Any active member may write name/description/start_date/end_date (AS-029). target_launch_date/launch_confidence/launch_note/warranty_until/warranty_terms/baseline_frozen_at require a non-viewer/non-client role. portal_enabled/portal_enabled_at/visibility/deleted_at/archived_by require owner/admin. Every other column, present or future, must match its own schema default at INSERT and cannot change at all at UPDATE, computed generically via pg_attrdef/to_jsonb. Bypassed by service_role always, and, for two specific application writers, via the transaction-local app.projects_field_guard_bypass flag (F025c/F025d, matching F016j''s client_requests_triage_guard_bypass), told apart by TG_OP: assign_task_number()''s task_counter bump (F025c, TG_OP=UPDATE) skips this WHOLE guard for its own separate UPDATE statement on a different row (tasks), re-entering this trigger from outside; assign_project_key()''s key generation (F025d, TG_OP=INSERT) instead only exempts the `key` column from this one INSERT''s diff check (added to the identity-column set for that invocation only), because it shares the row and statement with every other column this guard still must check. Either way the flag is self-consumed by this guard the instant it is observed "on". Never reintroduces the enumeration this guard exists to remove: neither bypass is a new allow-listed column reachable by a caller -- a caller-supplied `key` value never triggers assign_project_key()''s write path and stays rejected exactly as before.';

-- ---------------------------------------------------------------------
-- assign_project_key(): set the bypass flag before writing NEW.key.
-- Recreated in full (CREATE OR REPLACE replaces the whole body) with no
-- other change from 20260819061442's version.
-- ---------------------------------------------------------------------

create or replace function public.assign_project_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key is null or new.key = '' then
    -- F025d: this write is the application's own internal bookkeeping
    -- (generating the project's key), not a member creating a project
    -- with a pre-set key, so it steps around projects_enforce_field_
    -- role_allowlist for the guard invocation that immediately follows
    -- this trigger in the same statement (projects_assign_key sorts
    -- before projects_enforce_field_role_allowlist by name). The guard
    -- itself turns this flag back off the instant it observes it on --
    -- see that function's own comment for why the reset cannot live
    -- here.
    perform set_config('app.projects_field_guard_bypass', 'on', true);
    new.key := public.generate_unique_project_key(new.workspace_id, new.name);
  end if;
  return new;
end;
$$;

comment on function public.assign_project_key() is
  'F145/F025d: assigns a project''s key on INSERT (and defensively, on any future write that still holds the sentinel default) via generate_unique_project_key. F025d: sets the transaction-local app.projects_field_guard_bypass flag before writing NEW.key so F020b''s allow-list guard (20261017010000), which otherwise sees key already populated by the time it runs (BEFORE INSERT triggers fire in trigger-name order, and this trigger sorts first), does not reject every authenticated project INSERT with a false "not an allow-listed column" error -- key is not a member-editable column and was never meant to be allow-listed by name.';
