-- F006i (missions/20260903-portal): close the four authorisation gaps
-- found by the M1 re-scrutiny (missions/20260903-portal/milestones/
-- M1-scrutiny-2.md, NM-1, NM-3, NM-4, and section 4 item 1 / FU-21).
--
-- Every function below is re-created with `create or replace function`
-- (no signature changes anywhere in this file), so existing grants are
-- preserved automatically except where explicitly re-declared for
-- defense-in-depth clarity, matching this mission's own precedent
-- (20260908010000's header comment).
--
-- ---------------------------------------------------------------------
-- 1. seed_default_phases (NM-1): the role half of the guard was fixed by
--    F006d (20260914010000), but the visibility half — what
--    seedDefaultPhasesImpl's own `withAuthz` call enforces via
--    `requireVisibility: true` (lib/actions/phases.ts:188) — was never
--    ported into the RPC body. A workspace `member`/`guest` who is NOT in
--    `project_members` for a `visibility = 'private'` project (for whom
--    the Server Action itself returns "You don't have permission to
--    manage this project's phases") could call
--    `POST /rest/v1/rpc/seed_default_phases` directly and insert ten
--    rows — and `project_phases.client_visible` defaults to `true`, so
--    those rows then render in that project's client portal.
--
--    Fixed by adding the exact same `is_project_visible_to` check every
--    other project-scoped predicate in this schema already uses
--    (20260908010000:37-64), plus the `deleted_at is null` check
--    `loadProjectExtra` (lib/actions/phases.ts:152-160) applies before
--    the Server Action ever reaches the RPC — NM-1 explicitly names both
--    as unchecked.
-- ---------------------------------------------------------------------

create or replace function public.seed_default_phases(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
  v_deleted_at timestamptz;
  v_caller_role text;
  v_existing_count integer;
begin
  select workspace_id, deleted_at into v_workspace_id, v_deleted_at
    from projects where id = p_project_id;

  if v_workspace_id is null or v_deleted_at is not null then
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

  -- NM-1: the missing half. Matches seedDefaultPhasesImpl's
  -- `requireVisibility: true` (lib/actions/phases.ts:188) — a private
  -- project also requires an explicit project_members row.
  if not public.is_project_visible_to(p_project_id) then
    raise exception 'You do not have access to this project.'
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
-- 2. client_requests UPDATE / DELETE author policies (NM-3): F006b
--    (20260913010000) folded `is_project_portal_enabled` into the SELECT
--    and INSERT policies, and its own header comment claims "a direct
--    PostgREST call is closed too, not only the app's own query" — but
--    the UPDATE and DELETE author policies (20260902030000:132-141,
--    :162-166) were never touched. A client holding a request id on a
--    project whose portal was subsequently disabled could still `PATCH`
--    and `DELETE` that row directly, even though they can no longer read
--    it. The team policy (`client_requests_update_team`) is intentionally
--    left untouched — the team must still be able to manage a request on
--    a portal-disabled project internally, same distinction F006b's own
--    migration draws.
-- ---------------------------------------------------------------------

drop policy if exists client_requests_update_author_while_submitted on public.client_requests;
create policy client_requests_update_author_while_submitted
  on public.client_requests
  for update
  to authenticated
  using (
    created_by = auth.uid()
    and status = 'submitted'
    and public.is_project_portal_enabled(project_id)
  )
  with check (
    created_by = auth.uid()
    and status = 'submitted'
    and converted_task_id is null
    and reviewed_by is null
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists client_requests_delete_author_while_submitted on public.client_requests;
create policy client_requests_delete_author_while_submitted
  on public.client_requests
  for delete
  to authenticated
  using (
    created_by = auth.uid()
    and status = 'submitted'
    and public.is_project_portal_enabled(project_id)
  );

-- ---------------------------------------------------------------------
-- 3. assert_portal_task_actionable_by_client (NM-4): checks workspace
--    client membership, is_project_visible_to, client_visible and
--    pending_client_approval — but never is_project_portal_enabled.
--    F006b's audit (this feature's own predecessor) was scoped to reads
--    only, so this write path was never in view. A client of a
--    portal-disabled project with a known task id could still call
--    approvePortalTask / requestPortalTaskChanges
--    (lib/actions/portal-approval.ts) and clear pending_client_approval
--    on a project they can no longer see through the app. Both
--    approve_portal_task_atomic and request_portal_task_changes_atomic
--    delegate their authorisation to this one helper (20260906010000's
--    own header), so fixing it here closes both call sites at once.
-- ---------------------------------------------------------------------

create or replace function public.assert_portal_task_actionable_by_client(
  p_task_id uuid
)
returns table (task_id uuid, project_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_client_visible boolean;
  v_pending boolean;
  v_deleted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select t.project_id, p.workspace_id, t.client_visible, t.pending_client_approval, t.deleted_at
    into v_project_id, v_workspace_id, v_client_visible, v_pending, v_deleted_at
    from tasks t
    join projects p on p.id = t.project_id
   where t.id = p_task_id
     for update of t;

  if v_project_id is null or v_deleted_at is not null then
    raise exception 'task not found';
  end if;

  if not exists (
    select 1
      from workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = v_user_id
       and wm.status = 'active'
       and wm.role = 'client'
  ) then
    raise exception 'task not found';
  end if;

  if not public.is_project_visible_to(v_project_id) then
    raise exception 'task not found';
  end if;

  -- NM-4 fix: the missing check. Same "task not found" oracle as every
  -- other rejection branch in this function — a client of a
  -- portal-disabled project must not be able to distinguish "portal off"
  -- from "task doesn't exist" or "task not pending".
  if not public.is_project_portal_enabled(v_project_id) then
    raise exception 'task not found';
  end if;

  if not v_client_visible or not v_pending then
    raise exception 'task not found';
  end if;

  return query select p_task_id, v_project_id;
end;
$$;

revoke all on function public.assert_portal_task_actionable_by_client(uuid) from public;
-- No direct grant, matching 20260906010000's own comment: this is an
-- internal helper called only from approve_portal_task_atomic and
-- request_portal_task_changes_atomic, both SECURITY DEFINER and both
-- already granted to `authenticated` — unchanged by this migration.

-- ---------------------------------------------------------------------
-- 4. create_channel_atomic (M1-scrutiny-2.md section 4, item 1; FU-21):
--    pre-existing since the original 20260905090000 (confirmed by
--    reading it — the only mention of auth.uid() is a comment, never a
--    check), but this mission re-created the function twice
--    (20260910010000 nullable-args rewrite, 20260914010000 pg_temp
--    pinning) and carried the gap forward both times, the second under
--    an "authz gaps" banner. SECURITY DEFINER, granted to `authenticated`
--    directly (not only service_role), body was two unguarded INSERTs on
--    caller-supplied workspace_id, created_by and member_ids: any
--    authenticated user could create a channel in any workspace,
--    attribute it to any user, and add arbitrary members.
--
--    The equivalent guarded RPC this repo already has for exactly this
--    shape — granted to BOTH `authenticated` and `service_role`, where
--    only the direct `authenticated` path needs a self-check because the
--    `service_role` caller already re-verified everything itself before
--    calling — is public.create_notification(), fixed in
--    20260823030000_fix_create_notification_spoofing.sql:88-111: it pins
--    the actor to auth.uid() and requires the caller to be an active
--    member of the target workspace, but ONLY when auth.uid() is not
--    null (a `service_role` JWT carries no `sub` claim, so auth.uid() is
--    null for the Server Action's own admin-client call — same
--    "already checked, don't re-block ourselves" rationale documented at
--    the top of lib/actions/chat-channels.ts). The identical
--    `auth.uid() is null` branch is used again in
--    write_task_activity_entry
--    (20260823060000_fix_write_task_activity_entry_forgery.sql:60-70).
--    That is the shape followed below: lib/actions/chat-channels.ts's own
--    createChannel Server Action (the only production caller today —
--    confirmed by repo-wide grep, no UI wires this RPC up yet) always
--    calls this RPC via createAdminClient() after independently
--    re-verifying workspace membership and project visibility itself
--    (chat-channels.ts:75-115), so it is unaffected by the new checks
--    below; a direct `authenticated` caller is not.
--
--    Per the feature spec: the caller must be an active NON-CLIENT
--    member of p_workspace_id, p_created_by must equal auth.uid(), and
--    every id in p_member_ids must be a member of that workspace.
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
  v_caller_role text;
  v_missing_member_id uuid;
begin
  if auth.uid() is not null then
    if p_created_by is distinct from auth.uid() then
      raise exception 'create_channel_atomic: p_created_by must match the authenticated caller'
        using errcode = '42501';
    end if;

    select wm.role into v_caller_role
      from workspace_members wm
     where wm.workspace_id = p_workspace_id
       and wm.user_id = auth.uid()
       and wm.status = 'active';

    if v_caller_role is null or v_caller_role = 'client' then
      raise exception 'create_channel_atomic: caller is not an active non-client member of this workspace'
        using errcode = '42501';
    end if;

    select member_id into v_missing_member_id
      from unnest(p_member_ids) as member_id
     where not exists (
       select 1 from workspace_members wm2
        where wm2.workspace_id = p_workspace_id
          and wm2.user_id = member_id
          and wm2.status = 'active'
     )
     limit 1;

    if v_missing_member_id is not null then
      raise exception 'create_channel_atomic: every member must be an active member of this workspace'
        using errcode = '42501';
    end if;
  end if;

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
