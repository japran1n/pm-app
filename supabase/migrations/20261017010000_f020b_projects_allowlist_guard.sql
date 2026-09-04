-- F020b (missions/20260903-portal, M4 remediation — blocker, B2): the
-- eighth instance of one class in this mission.
--
-- ---------------------------------------------------------------------
-- Defect (AS-040, M4-scrutiny B2) — F020 added `projects.
-- baseline_frozen_at` and never extended F006k's field-role trigger
-- (`enforce_project_portal_and_launch_field_role`,
-- 20260919010000). Verified: zero occurrences of `baseline_frozen_at`
-- in that migration. `projects_update_active_members`
-- (20260818004709:45-55) has no role restriction at all — any ACTIVE
-- workspace member, including `client` and `viewer`, may
-- `PATCH /rest/v1/projects?id=eq.<pid>` with
-- `{"baseline_frozen_at": null}`. A writer can then edit
-- `project_metrics.baseline_value` and re-freeze, and the "frozen"
-- guarantee AS-040 exists to provide, and that the whole Results view
-- (F021) rests on, is gone. Two more holes share the same root:
--   - the trigger is `BEFORE UPDATE` only, so a writer can delete the
--     frozen metric row and re-insert it under the same name with a new
--     baseline (F016f closed this exact hole on `client_requests` by
--     extending to `BEFORE INSERT OR UPDATE`; `projects` never got the
--     same treatment for its own field-role trigger);
--   - `project_metrics.direction` stays editable on a frozen metric
--     (deliberate per 20261013010000's header, which only guards
--     `baseline_value`/`baseline_at` BY NAME) — flipping `direction`
--     from `lower` to `higher` turns every "Regressed" badge into
--     "Improved" with no baseline write at all.
--
-- This is the eighth appearance of one class in this mission (F006b,
-- F006i, F006k, F006l, F009b, F016d, F016j, this). F006k's own spec
-- asked for a sweep of every column this mission had added to a
-- pre-existing table; that sweep came back clean because F020's column
-- did not exist yet at F006k's time. F016j (20261008010000) then
-- inverted `client_requests`' equivalent guard from a hand-enumerated
-- deny-list to an allow-list computed from the live schema via
-- `pg_attrdef`, so a column added later is covered without editing the
-- guard. Nobody applied that inversion to `projects`; F006k's own
-- trigger stayed a hand-written enumeration of the columns it *did*
-- know about, and F020's column walked straight through it.
--
-- Fix, per this feature's own instruction, porting F016j's technique to
-- `projects` with F006k's own two role bars preserved (verified at
-- 20260919010000 and 20261016010000 — grepped, not recalled):
--
--   1. Invert to an allow-list. Every column of `projects`, present or
--      future, falls into exactly one tier:
--        - MEMBER tier (`name`, `description`, `start_date`,
--          `end_date`) — any active workspace member may write these,
--          no further role check (AS-029, preserved verbatim from
--          20260818004709's own policy comment: "any active member ...
--          not just admins"). This trigger fires unconditionally for
--          this tier; nothing in it needs `auth.uid()`'s role.
--        - IDENTITY tier (`id`, `workspace_id`, `created_at`,
--          `updated_at`, `created_by`) — never diffed; these are
--          system-assigned and no UI path or RLS policy lets a caller
--          choose them freely regardless of role (`workspace_id` in
--          particular: `projects_insert_active_members`'s own `with
--          check` already re-validates it, and no action ever moves a
--          project between workspaces at UPDATE — locking it here at
--          the trigger is defense in depth, not a new restriction).
--        - WRITER tier (`target_launch_date`, `launch_confidence`,
--          `launch_note`, `warranty_until`, `warranty_terms`,
--          `baseline_frozen_at`) — F006k's own "ordinary project
--          management field" bar (`role not in ('viewer', 'client')`),
--          now covering the freeze flag too: freezing is the same kind
--          of everyday team action as setting `target_launch_date`, so
--          it gets the same bar, not the tighter one below (matches
--          20261013010000's own header: "goes through the ordinary
--          team UPDATE path ... same as any other single-column project
--          setting write in this schema").
--        - OWNER_ADMIN tier (`portal_enabled`, `portal_enabled_at`,
--          `visibility`, `deleted_at`, `archived_by`) — F006k's
--          tighter bar (`role in ('owner', 'admin')`), now including
--          `visibility` and the archive columns explicitly rather than
--          relying solely on the separate
--          `enforce_project_visibility_change_role` trigger
--          (20260821140526, left untouched, out of this feature's
--          scope per F006k's own precedent of leaving that trigger
--          alone) and `archiveProject`'s application-level admin/owner
--          check (`lib/actions/projects.ts:213`) — this guard now backs
--          both up structurally, the same way F016j's guard backs up
--          RLS's own `WITH CHECK` instead of replacing it.
--      Any column NOT named above (i.e. added by a future migration)
--      must equal its own schema default at INSERT and cannot change at
--      all at UPDATE — computed generically via `pg_attrdef`/`to_jsonb`,
--      exactly as F016j did, so it is protected by default instead of
--      exposed by default.
--   2. Extend to `BEFORE INSERT OR UPDATE` (F016f's own lesson,
--      verified applied at 20261005010000): `projects_insert_active_
--      members` has no role restriction either, so a client could
--      otherwise `POST /rest/v1/projects` with `portal_enabled: true`
--      and skip the UPDATE guard entirely.
--   3. `project_metrics.direction` — gated in this same migration by
--      extending 20261013010000's own `prevent_frozen_baseline_update`
--      trigger (by name, matching that migration's own "guard BY NAME,
--      not the whole row" convention) to also cover `direction`: once a
--      project's baseline is frozen, `direction` freezes with it, since
--      it is part of what "the before" means, not an independent
--      display setting.
--   4. A regression test (tests/integration/f020b-...) that adds a
--      throwaway column to `projects` inside a rolled-back transaction
--      and proves the guard rejects a write to it by an ordinary member,
--      without the guard's SQL being touched.
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
    -- Self-maintaining default row, computed from the catalog rather
    -- than hand-copied (F016j's own technique): a column added by a
    -- later migration gets a default entry here automatically, with no
    -- edit to this function required.
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

    -- Any column NOT named above (future column) must equal its own
    -- default at insert.
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
    -- UPDATE: any column NOT named above (future column) cannot change
    -- at all.
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
  'F006k/F020b: allow-list guard (F020b inverted this from F006k''s hand-enumerated deny-list, matching F016j''s technique on client_requests) on projects, now BEFORE INSERT OR UPDATE (F020b, matching F016f''s lesson). Any active member may write name/description/start_date/end_date (AS-029). target_launch_date/launch_confidence/launch_note/warranty_until/warranty_terms/baseline_frozen_at require a non-viewer/non-client role. portal_enabled/portal_enabled_at/visibility/deleted_at/archived_by require owner/admin. Every other column, present or future, must match its own schema default at INSERT and cannot change at all at UPDATE, computed generically via pg_attrdef/to_jsonb so a column added later is covered without editing this function.';

drop trigger if exists projects_enforce_portal_and_launch_field_role on projects;
drop function if exists public.enforce_project_portal_and_launch_field_role();

drop trigger if exists projects_enforce_field_role_allowlist on projects;
create trigger projects_enforce_field_role_allowlist
  before insert or update on projects
  for each row
  execute function public.enforce_projects_field_role_allowlist();

-- ---------------------------------------------------------------------
-- project_metrics.direction freezes with the baseline (Scope item 3).
-- Extends 20261013010000's own function BY NAME, matching that
-- migration's own convention.
-- ---------------------------------------------------------------------

-- Also closes M4-scrutiny B2 item 2 (delete-then-reinsert): a writer
-- could drop a frozen metric row and re-insert it under the same name
-- with a fresh baseline, since the old BEFORE UPDATE-only trigger never
-- saw a DELETE. Blocking DELETE outright on a metric that carries a
-- baseline while its project is frozen closes that path without
-- touching `project_metrics_delete_team`'s RLS (which stays
-- writer-gated as before) -- matches `metric_snapshots`' own
-- already-established "append-only, not edited in place" philosophy
-- (20261013010000's own header) rather than inventing a second one.
create or replace function public.prevent_frozen_baseline_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_frozen_at timestamptz;
  v_project_id uuid;
  v_baseline_value numeric;
  v_baseline_at date;
  v_metric_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_project_id := OLD.project_id;
    v_baseline_value := OLD.baseline_value;
    v_baseline_at := OLD.baseline_at;
    v_metric_id := OLD.id;

    if v_baseline_value is not null or v_baseline_at is not null then
      select p.baseline_frozen_at into v_frozen_at from public.projects p where p.id = v_project_id;

      if v_frozen_at is not null then
        raise exception
          'project_metrics: baseline is frozen for this project and this metric cannot be deleted (metric_id=%, project_id=%)',
          v_metric_id, v_project_id
          using errcode = '42501';
      end if;
    end if;

    return OLD;
  end if;

  if NEW.baseline_value is distinct from OLD.baseline_value
     or NEW.baseline_at is distinct from OLD.baseline_at
     or NEW.direction is distinct from OLD.direction
  then
    select p.baseline_frozen_at
      into v_frozen_at
      from public.projects p
     where p.id = OLD.project_id;

    if v_frozen_at is not null then
      raise exception
        'project_metrics: baseline is frozen for this project and cannot be changed (metric_id=%, project_id=%)',
        OLD.id, OLD.project_id
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$$;

comment on function public.prevent_frozen_baseline_update() is
  'F020/F020b: guards baseline_value, baseline_at and (F020b) direction BY NAME once a project''s baseline_frozen_at is set -- direction is part of what "the before" means, so it freezes with the baseline rather than staying independently editable (F020b/M4-scrutiny B2, item 3). Also (F020b) blocks DELETE of a metric that carries a baseline while its project is frozen, closing the delete-then-reinsert bypass (M4-scrutiny B2 item 2). Every other column of a frozen metric (name, client_visible, position, target_value, display_max, ...) stays freely editable, and deleting a metric that never had a baseline is unaffected.';

drop trigger if exists project_metrics_prevent_frozen_baseline_delete on project_metrics;
create trigger project_metrics_prevent_frozen_baseline_delete
  before delete on project_metrics
  for each row
  execute function public.prevent_frozen_baseline_update();
