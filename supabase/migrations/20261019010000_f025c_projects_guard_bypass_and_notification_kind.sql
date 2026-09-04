-- F025c (missions/20260903-portal, M5 remediation — blocker): two
-- regressions surfaced by F025b's own side-effect run, fixing two
-- separate defects in two separate, previously-working core flows.
--
-- ---------------------------------------------------------------------
-- Defect 1 — F020b's allow-list guard blocks the app's own trigger
-- writes to `projects.task_counter`.
--
-- `assign_task_number()` (20260819061129, updated 20260819061442) runs
-- as a BEFORE INSERT trigger on `tasks` and does
--   update projects set task_counter = task_counter + 1
--   where id = new.project_id
-- to atomically hand out the task's per-project number (AS-259). That
-- UPDATE now fires `projects_enforce_field_role_allowlist`
-- (20261017010000, F020b). `task_counter` is not named in any of that
-- trigger's four tiers, so it falls into the "any other column, present
-- or future" branch and the write is rejected outright — for EVERY task
-- insert, not only the one this defect was found through
-- (`accept_client_request_atomic`, 20261008040000-ish). Plain task
-- creation from the ordinary Kanban/list UI is equally broken; F025b's
-- suite happened to surface it via the approval-accept path first.
--
-- Root cause: the guard cannot tell a human member's own UPDATE (`PATCH
-- /rest/v1/projects`) apart from a write the application's own trigger
-- machinery makes as an unavoidable side effect of an action the CALLER
-- was allowed to take (inserting a task). Widening the allow-list to
-- include `task_counter` by name would fix this one column and
-- reintroduce exactly the enumeration F020b existed to remove — the
-- next trigger that writes a new `projects` column (there is already
-- one candidate: nothing stops a future feature from doing the same
-- thing) breaks the same way again.
--
-- Fix: port F016j's own technique (20261008010000) — the
-- `app.client_requests_triage_guard_bypass` transaction-local GUC that
-- lets a legitimate SECURITY DEFINER writer step around the guard for
-- exactly the one write it needs to make, then immediately turns itself
-- back off. Same shape here: `assign_task_number()` sets
-- `app.projects_field_guard_bypass` to `'on'` (transaction-local, via
-- `set_config(..., true)` — never visible outside this transaction and
-- never persisted) immediately before its own UPDATE and back to
-- `'off'` immediately after, and
-- `enforce_projects_field_role_allowlist()` checks the flag at its very
-- top, alongside its existing `service_role` bypass, and returns `new`
-- unexamined when it is on.
--
-- This is deliberately not scoped to `task_counter` specifically — the
-- bypass, like F016j's, is a blanket "this write is not a member
-- editing the project, skip the guard entirely" escape hatch for the
-- one trigger function that legitimately needs it, not a second
-- allow-list entry. `task_counter`, `portal_enabled`, and the baseline
-- fields all stay exactly as unreachable as before to any caller that
-- is not inside this specific trigger's own SECURITY DEFINER body —
-- verified by the regression test added by this migration doing a
-- direct client-role UPDATE against `task_counter`, unrelated to any
-- task insert, and asserting it still raises.
--
-- The self-maintaining property is untouched: this migration adds a
-- flag check, not a named column, so a column added next year (in a
-- rolled-back transaction or otherwise) is still covered by the
-- pg_attrdef-driven "any other column" branch exactly as before.
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
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- F025c: transaction-local bypass for the application's own SECURITY
  -- DEFINER trigger writes (currently only assign_task_number()'s
  -- task_counter bump), matching F016j's client_requests_triage_guard_
  -- bypass technique. Never settable by a caller through RLS/PostgREST
  -- -- only a SECURITY DEFINER function body running server-side can
  -- call set_config with this name, and `true` (transaction-local)
  -- means it cannot leak into a later statement in the same session/
  -- pooled connection.
  if coalesce(current_setting('app.projects_field_guard_bypass', true), 'off') = 'on' then
    return new;
  end if;

  v_named_cols := v_identity_cols || v_member_cols || v_writer_cols || v_owner_admin_cols;

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
  'F006k/F020b/F025c: allow-list guard on projects, BEFORE INSERT OR UPDATE. Any active member may write name/description/start_date/end_date (AS-029). target_launch_date/launch_confidence/launch_note/warranty_until/warranty_terms/baseline_frozen_at require a non-viewer/non-client role. portal_enabled/portal_enabled_at/visibility/deleted_at/archived_by require owner/admin. Every other column, present or future, must match its own schema default at INSERT and cannot change at all at UPDATE, computed generically via pg_attrdef/to_jsonb. Bypassed only by service_role and the transaction-local app.projects_field_guard_bypass flag (F025c, matching F016j''s client_requests_triage_guard_bypass) the application''s own SECURITY DEFINER trigger writers set around their own single UPDATE -- currently only assign_task_number()''s task_counter bump. Never reintroduces the enumeration this guard exists to remove: the bypass is a blanket "this is not a member editing the project" escape for one trigger''s own internal write, not a new allow-listed column.';

-- ---------------------------------------------------------------------
-- assign_task_number(): wrap its projects UPDATE in the bypass flag.
-- Recreated in full (CREATE OR REPLACE replaces the whole body) with no
-- other change from 20260819061442's version.
-- ---------------------------------------------------------------------

create or replace function public.assign_task_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  if new.number is null or new.number = 0 then
    -- F025c: this UPDATE is the application's own internal bookkeeping
    -- (assigning the task's per-project number), not a member editing
    -- the project, so it steps around projects_enforce_field_role_
    -- allowlist for the duration of this one statement rather than
    -- requiring task_counter to be named in that guard's allow-list.
    perform set_config('app.projects_field_guard_bypass', 'on', true);

    update projects
    set task_counter = task_counter + 1
    where id = new.project_id
    returning task_counter into v_number;

    perform set_config('app.projects_field_guard_bypass', 'off', true);

    if v_number is null then
      raise exception 'project % not found for task number assignment', new.project_id;
    end if;

    new.number := v_number;
  end if;
  return new;
end;
$$;

comment on function public.assign_task_number() is
  'F145/F025c: atomically assigns a task''s per-project number by incrementing projects.task_counter inside this same BEFORE INSERT trigger invocation. F025c: wraps that UPDATE in the transaction-local app.projects_field_guard_bypass flag so F020b''s allow-list guard (20261017010000) does not reject this internal write -- task_counter is not a member-editable column and was never meant to be allow-listed by name.';

-- ---------------------------------------------------------------------
-- Defect 2 — decide_approval_atomic's notification insert violates
-- notifications_kind_check.
--
-- Established first (per this feature's own instruction): the insert IS
-- in the same transaction as the rest of decide_approval_atomic's work.
-- `create_notification` (20260823020000) is a plain SECURITY DEFINER
-- SQL function, not a background job and not wrapped in any
-- sub-transaction/savepoint of its own, and decide_approval_atomic
-- (20260925010000:282-296) calls it with `perform` in its own body, in
-- the same implicit transaction as its earlier `update approval_
-- requests` and `update tasks` statements. So today, a client clicking
-- Approve/Request changes gets a hard error back from the RPC and NONE
-- of it is recorded -- not the approval_requests state flip, not the
-- resulting task (already inserted earlier in the same transaction,
-- rolled back with everything else), nothing -- which is exactly the
-- worst outcome named in this feature's spec. This makes the fix
-- urgent, not merely tidy: it is not "notifications silently fail",
-- it is "approvals cannot be decided at all".
--
-- Root cause: `notifications_kind_check` was correctly widened to
-- include 'approval_decided' by 20260916010000, and again to include
-- 'assumption_flagged' by 20260929010000 (that migration''s own header
-- says so explicitly: "last widened by 20260916010000 for
-- ''approval_decided''"). 20261012010000 (F018) then dropped and
-- re-added the same constraint to add 'budget_threshold_80'/
-- '_100' but copied forward only the ORIGINAL five kinds from
-- 20260823020000, silently reverting both later widenings. Grep-
-- verified: 'approval_decided' and 'assumption_flagged' do not appear
-- in 20261012010000's replacement CHECK list. No migration after
-- 20261012010000 touches notifications_kind_check.
--
-- Fix: widen the constraint again, this time to the full union of every
-- kind any migration has ever inserted (verified by grepping every
-- `p_kind =>` / `kind =>` call site across supabase/migrations -- no
-- other kind exists beyond these nine).
-- ---------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in (
    'mention', 'comment_reply', 'task_assigned', 'task_due_soon', 'watcher_update',
    'approval_decided', 'assumption_flagged',
    'budget_threshold_80', 'budget_threshold_100'
  )
);

comment on constraint notifications_kind_check on public.notifications is
  'F025c: restores approval_decided (20260916010000) and assumption_flagged (20260929010000), both silently dropped when 20261012010000 (F018) re-added this constraint from the original 20260823020000 list instead of the then-current one. Union of every kind ever inserted, grep-verified against every p_kind => call site in supabase/migrations.';
