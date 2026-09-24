-- seed_default_phases: restore the `is_project_visible_to` check.
--
-- 20260922010000 replaced it with an inline copy of the application-side
-- rule, which at the time let a guest through on any workspace-visible
-- project. The application rule now matches `is_project_visible_to`
-- (guests and clients need a project_members row whatever the project's
-- visibility), so the RPC goes back to calling the shared predicate. Body
-- otherwise identical to 20260918010000.
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
