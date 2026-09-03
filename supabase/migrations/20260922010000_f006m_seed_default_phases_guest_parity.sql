-- F006m (M1 scrutiny round 3, minor): seed_default_phases' visibility check
-- disagreed with the Server Action's own gate.
--
-- F006i (20260918010000) added `public.is_project_visible_to(p_project_id)`
-- to seed_default_phases, matching seedDefaultPhasesImpl's
-- `requireVisibility: true` (lib/actions/phases.ts:188) in *name* only.
-- `requireVisibility: true` actually runs `isProjectVisibleToCaller`
-- (lib/actions/project-visibility.ts:16-31), which returns true for ANY
-- role when the project is `visibility = 'workspace'`. The SQL predicate
-- `is_project_visible_to` (20260908010000:37-64) is stricter: it excludes
-- role 'guest' from the workspace-visibility branch entirely, requiring an
-- explicit `project_members` row even on a workspace-visible project.
--
-- Effect: a workspace `guest` on a `visibility = 'workspace'` project, with
-- no `project_members` row, passes the Server Action's own checks (it can
-- create phases one at a time — `project_phases_insert_team` uses
-- `is_project_workspace_writer`, which admits guest) but the RPC now raises
-- 42501 for the ten-at-once seeding path. The two must agree by
-- construction.
--
-- Fix: replace the call to `is_project_visible_to` with the exact rule
-- `isProjectVisibleToCaller` implements, inline, using the caller's role
-- and the project's own `visibility` column (already available via
-- v_workspace_id's sibling select). This is NOT a relaxation of F006i's
-- actual fix: a member/guest who is NOT in `project_members` on a
-- `visibility = 'private'` project is still rejected, because the
-- workspace-visibility branch only fires when `p.visibility = 'workspace'`.
create or replace function public.seed_default_phases(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
  v_deleted_at timestamptz;
  v_visibility text;
  v_caller_role text;
  v_existing_count integer;
  v_is_member boolean;
begin
  select workspace_id, deleted_at, visibility
    into v_workspace_id, v_deleted_at, v_visibility
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

  -- F006m: mirror isProjectVisibleToCaller
  -- (lib/actions/project-visibility.ts:16-31) exactly, not
  -- is_project_visible_to, which the Server Action's own gate never calls.
  -- workspace-visible projects are visible to any active member
  -- (guest included); owners/admins see every project; everyone else
  -- needs an explicit project_members row.
  if v_visibility <> 'workspace' and v_caller_role not in ('owner', 'admin') then
    select exists (
      select 1
      from project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
    ) into v_is_member;

    if not v_is_member then
      raise exception 'You do not have access to this project.'
        using errcode = '42501';
    end if;
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
