-- F006d (missions/20260903-portal): close two of the three authorisation
-- gaps found by the M1 scrutiny review that require a SQL change
-- (missions/20260903-portal/milestones/M1-scrutiny.md, M2 and M4; the
-- third, M1 itself, is an application-code fix to bulkSetTaskPhase in
-- lib/actions/phases.ts, not a migration).
--
-- Step 4 of the feature spec ("sweep every SECURITY DEFINER function this
-- mission has added or replaced") was carried out by grepping every
-- migration whose own header comment tags it `missions/20260903-portal`
-- (F001 20260909010000, F002b 20260910010000, F004 20260911010000, F005b
-- 20260912010000, F006b 20260913010000) plus this one. The full sweep
-- result — every SECURITY DEFINER function in that set, ticked — is in
-- this feature's handoff. Two more functions of the same defect class
-- (accept_client_request_atomic, change_workspace_slug_atomic) and one
-- trigger function (check_doc_folder_scope) were found unpinned during a
-- broader repo-wide grep, but their own header comments attribute them to
-- a DIFFERENT mission (missions/20260828-hardening's W7e, and an untagged
-- W1 docs-system migration, respectively) — out of scope for this feature
-- per its own "sweep every SECURITY DEFINER function THIS MISSION has
-- added or replaced" wording. Left unfixed here; flagged in the handoff's
-- Out-of-scope work needed section for a follow-up feature.
--
-- ---------------------------------------------------------------------
-- 1. seed_default_phases (M2): the guard was a `= 'client'` deny-list;
--    its own comment claims the shape `apply_status_template`
--    (20260903010000) uses, but that function's guard is an allow-list
--    (`not in ('owner','admin')`). The workspace role domain is
--    owner|admin|member|viewer|guest|client, so a `viewer` — who
--    `project_phases_insert_team`'s own `is_project_workspace_writer`
--    predicate (20260908010000:69-84) explicitly excludes — could insert
--    the ten default phases by calling the RPC directly.
--
--    Fixed by switching the guard to the exact allow-list
--    `is_project_workspace_writer` already uses:
--    `wm.role not in ('viewer', 'client')`. Body, signature, grants
--    otherwise byte-identical to the live definition (20260909010000).
-- ---------------------------------------------------------------------

create or replace function public.seed_default_phases(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
  v_caller_role text;
  v_existing_count integer;
begin
  select workspace_id into v_workspace_id from projects where id = p_project_id;
  if v_workspace_id is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  select wm.role into v_caller_role
  from workspace_members wm
  where wm.workspace_id = v_workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'active';

  if v_caller_role is null or v_caller_role in ('viewer', 'client') then
    raise exception 'Only an active team member may seed default phases.'
      using errcode = '42501';
  end if;

  select count(*) into v_existing_count
  from project_phases
  where project_id = p_project_id;

  if v_existing_count > 0 then
    return;
  end if;

  insert into project_phases (project_id, name, client_description, position)
  values
    (p_project_id, 'Kick-off & setup', 'Deciding who approves what, and setting up the tools we will work in.', 1),
    (p_project_id, 'Audit & baseline', 'Measuring the current site so we can prove what changed after launch.', 2),
    (p_project_id, 'Site structure', 'Agreeing every page and every URL before anything is designed.', 3),
    (p_project_id, 'Visual direction', 'Choosing the look — moodboard, style, and one design direction.', 4),
    (p_project_id, 'Page design', 'Designing each page in Figma, for your approval, page by page.', 5),
    (p_project_id, 'Assets & content', 'Preparing images and getting the real text onto the pages.', 6),
    (p_project_id, 'Build', 'Building the approved designs in Webflow.', 7),
    (p_project_id, 'Quality assurance', 'A second developer and the designer check every page.', 8),
    (p_project_id, 'Launch', 'Going live, with tracking and redirects verified.', 9),
    (p_project_id, 'Handover', 'Training, documentation, and moving every account into your name.', 10);
end;
$$;

revoke all on function public.seed_default_phases(uuid) from public;
grant execute on function public.seed_default_phases(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. create_channel_atomic (M4): re-created (dropped + created, not
--    replaced) by F002b's 20260910010000_create_channel_atomic_nullable_
--    args.sql with `set search_path = public` — no `pg_temp` — carrying
--    forward the exact class of gap 20260908010000 exists to close on
--    every other SECURITY DEFINER predicate/RPC this mission touches.
--    `authenticated` has TEMP privileges by default, so a caller could
--    have shadowed `channels` / `channel_members` inside this body.
--
--    Signature is unchanged from 20260910010000's, so `create or replace
--    function` is used here (no drop needed). Body, return type,
--    volatility are byte-identical to the live definition; only
--    `search_path` changes. Grants re-declared explicitly since this
--    migration's own precedent (20260910010000) does so on every touch.
-- ---------------------------------------------------------------------

create or replace function public.create_channel_atomic(
  p_workspace_id uuid,
  p_kind text,
  p_created_by uuid,
  p_member_ids uuid[],
  p_project_id uuid default null,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel_id uuid;
begin
  insert into channels (workspace_id, project_id, kind, name, created_by)
  values (p_workspace_id, p_project_id, p_kind, p_name, p_created_by)
  returning id into v_channel_id;

  insert into channel_members (channel_id, user_id)
  select v_channel_id, member_id
    from unnest(p_member_ids) as member_id;

  return v_channel_id;
end;
$$;

revoke all on function public.create_channel_atomic(uuid, text, uuid, uuid[], uuid, text) from public;
grant execute on function public.create_channel_atomic(uuid, text, uuid, uuid[], uuid, text) to authenticated, service_role;
