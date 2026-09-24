-- Team-writer alignment for direct PostgREST writes (audit 2026-09-24).
--
-- The app decided that guests, viewers and clients do not get team-level
-- writes: `withAuthz({ requireWrite: true })` defaults to canTeamWrite
-- (owner/admin/member) and createTaskForUser/editTask gate on canEditTask
-- (same allow-list). A guest's writes are limited to contributing on tasks
-- in projects they were added to: comments, reactions, attachments and
-- time entries (AS-223).
--
-- The database still disagreed in four places, all reachable directly
-- through PostgREST with a user JWT:
--
-- 1. public.is_project_workspace_writer admitted a guest who is a
--    project_members row on the project. ~75 policies use it (tasks
--    insert/update, project_phases, briefs, budgets, decisions, custom
--    fields, scope items, deliverables, storage uploads for improvements
--    and scope documents, ...), so a guest could write all of them.
--    It becomes team-only (owner/admin/member).
--
--    public.is_task_workspace_writer is the only caller that needs the
--    guest branch: it gates INSERT on comments, attachments, time_entries
--    and the task-attachments storage objects. It used to delegate to
--    is_project_workspace_writer; it now carries the guest-aware rule
--    itself, unchanged in effect, so guest comment/attachment/time flows
--    keep working.
--
-- 2. checklist_items insert/update/delete only required
--    is_task_visible_to(task_id) -- any role that can see the task
--    (viewer, guest, a client on a client-visible task) could edit the
--    checklist. Editing a checklist is editing the task, so writes now also
--    require a team writer on the task's project (canEditTask on the app
--    side, lib/actions/checklist.ts).
--
-- 3. sitemap_shares SELECT used can_read_sitemap, which includes viewers,
--    so a viewer could read live public share tokens. Share rows are now
--    readable only by sitemap writers (owner/admin/member).
--
-- 4. mark_deliverable_delivered_atomic authorized with
--    client_gate(..., p_require_client_role => false): any active member
--    who can see the project -- viewers and guests included. It now
--    requires a client of the project or a team writer, on top of the same
--    visibility/portal checks (matches deliverPortalDeliverable's
--    isClient || canTeamWrite pre-check).
--
-- Every function (re)defined here gets explicit EXECUTE grants: this
-- database's f016i_revoke_default_execute event trigger revokes default
-- EXECUTE on CREATE FUNCTION, and every one of these is called from RLS
-- policies or by the app as `authenticated`.

-- ---------------------------------------------------------------------
-- 1. Team-only project writer; guest-aware task contributor.
-- ---------------------------------------------------------------------

create or replace function public.is_project_workspace_writer(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin', 'member')
  );
$$;

revoke all on function public.is_project_workspace_writer(uuid) from public;
revoke all on function public.is_project_workspace_writer(uuid) from anon;
grant execute on function public.is_project_workspace_writer(uuid) to authenticated;
grant execute on function public.is_project_workspace_writer(uuid) to service_role;

-- Task contribution (comments, attachments, time entries): a team writer,
-- or a guest who is an explicit member of the task's project.
create or replace function public.is_task_workspace_writer(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        wm.role in ('owner', 'admin', 'member')
        or (
          wm.role = 'guest'
          and exists (
            select 1
            from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
          )
        )
      )
  );
$$;

revoke all on function public.is_task_workspace_writer(uuid) from public;
revoke all on function public.is_task_workspace_writer(uuid) from anon;
grant execute on function public.is_task_workspace_writer(uuid) to authenticated;
grant execute on function public.is_task_workspace_writer(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 2. checklist_items writes: visible task AND team writer.
-- ---------------------------------------------------------------------

drop policy if exists checklist_items_insert_active_members on public.checklist_items;
drop policy if exists checklist_items_update_active_members on public.checklist_items;
drop policy if exists checklist_items_delete_active_members on public.checklist_items;

create policy checklist_items_insert_active_members
  on public.checklist_items for insert to authenticated
  with check (
    public.is_task_visible_to(task_id)
    and exists (
      select 1 from public.tasks t
      where t.id = checklist_items.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  );

create policy checklist_items_update_active_members
  on public.checklist_items for update to authenticated
  using (
    public.is_task_visible_to(task_id)
    and exists (
      select 1 from public.tasks t
      where t.id = checklist_items.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  )
  with check (
    public.is_task_visible_to(task_id)
    and exists (
      select 1 from public.tasks t
      where t.id = checklist_items.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  );

create policy checklist_items_delete_active_members
  on public.checklist_items for delete to authenticated
  using (
    public.is_task_visible_to(task_id)
    and exists (
      select 1 from public.tasks t
      where t.id = checklist_items.task_id
        and public.is_project_workspace_writer(t.project_id)
    )
  );

-- ---------------------------------------------------------------------
-- 3. sitemap_shares: readable by writers only.
-- ---------------------------------------------------------------------

drop policy if exists sitemap_shares_select_team on public.sitemap_shares;

create policy sitemap_shares_select_team
  on public.sitemap_shares for select to authenticated
  using (public.can_write_sitemap(sitemap_id));

-- ---------------------------------------------------------------------
-- 4. mark_deliverable_delivered_atomic: client of the project or team
--    writer (viewers and guests refused).
-- ---------------------------------------------------------------------

create or replace function public.mark_deliverable_delivered_atomic(p_deliverable_id uuid)
returns table(deliverable_id uuid, state text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_state text;
begin
  if v_user_id is null then
    raise exception 'mark_deliverable_delivered_atomic: not authenticated' using errcode = '28000';
  end if;

  select cd.project_id, cd.state
    into v_project_id, v_state
    from client_deliverables cd
   where cd.id = p_deliverable_id
     for update of cd;

  if v_project_id is null then
    raise exception 'mark_deliverable_delivered_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if not public.client_gate(v_project_id, p_require_client_role => false) then
    raise exception 'mark_deliverable_delivered_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if not (
    public.is_project_client(v_project_id)
    or public.is_project_workspace_writer(v_project_id)
  ) then
    raise exception 'mark_deliverable_delivered_atomic: you do not have permission to deliver this item' using errcode = '42501';
  end if;

  if v_state in ('accepted', 'waived') then
    raise exception 'mark_deliverable_delivered_atomic: this item has already been accepted' using errcode = '42501';
  end if;

  update client_deliverables
     set state = 'delivered',
         delivered_at = now(),
         review_note = null
   where id = p_deliverable_id;

  return query select p_deliverable_id, 'delivered'::text;
end;
$function$;

revoke all on function public.mark_deliverable_delivered_atomic(uuid) from public;
revoke all on function public.mark_deliverable_delivered_atomic(uuid) from anon;
grant execute on function public.mark_deliverable_delivered_atomic(uuid) to authenticated;
grant execute on function public.mark_deliverable_delivered_atomic(uuid) to service_role;
