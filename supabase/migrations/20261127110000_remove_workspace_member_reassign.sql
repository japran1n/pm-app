-- P2-25: when a workspace member is removed, any tasks assigned to them
-- either get reassigned to another member (p_reassign_to) or unassigned
-- (p_reassign_to IS NULL). Both the task_assignees join table and the
-- legacy tasks.assignee_id column are updated atomically inside the same
-- function body.
--
-- Visibility guard: when p_reassign_to is supplied, we only hand a task
-- to them if they can actually see its project — otherwise we silently
-- unassign that task instead of just moving the dangling reference to a
-- different user. The check mirrors is_project_visible_to (pinned in
-- 20260908010000_pin_pg_temp_on_client_visibility_predicates.sql) but
-- evaluated for p_reassign_to instead of auth.uid(), since this is
-- SECURITY DEFINER and we cannot use the RLS helper directly:
--
--   reassignee has role owner/admin
--   OR (role not in guest/client AND project.visibility = 'workspace')
--   OR reassignee is an explicit project_member
--
-- The existing sole-owner guard and TOCTOU locking are kept byte-for-byte
-- from 20260817234900_remove_member_atomic_owner_guard.sql; only the
-- assignment-cleanup block is new.
--
-- Grant: authenticated so the Server Action can call it via the normal
-- Supabase client; service_role kept for test harnesses.

create or replace function public.remove_workspace_member(
  p_membership_id uuid,
  p_workspace_id  uuid,
  p_reassign_to   uuid default null
)
returns table (
  deleted boolean,
  reason  text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id          uuid;
  v_role             text;
  v_status           text;
  v_remaining_owners int;
begin
  -- Lock the target row first so concurrent calls targeting the *same* row
  -- serialize on it too.
  select user_id, role, status
    into v_user_id, v_role, v_status
    from workspace_members
   where id           = p_membership_id
     and workspace_id = p_workspace_id
   for update;

  if not found then
    return query select false, 'not_found';
    return;
  end if;

  if v_status <> 'active' then
    return query select false, 'not_active';
    return;
  end if;

  if v_role = 'owner' then
    -- Lock all active-owner rows for this workspace so a concurrent call
    -- cannot read a stale count.
    perform 1
      from workspace_members
     where workspace_id = p_workspace_id
       and role         = 'owner'
       and status       = 'active'
       for update;

    select count(*)
      into v_remaining_owners
      from workspace_members
     where workspace_id = p_workspace_id
       and role         = 'owner'
       and status       = 'active';

    if v_remaining_owners <= 1 then
      return query select false, 'sole_owner';
      return;
    end if;
  end if;

  -- ── Assignment cleanup ──────────────────────────────────────────────────
  -- Only touch rows that belong to tasks inside THIS workspace (join via
  -- tasks → projects → workspace_id) so a multi-workspace user's
  -- assignments in other workspaces are left alone.

  if v_user_id is not null then

    if p_reassign_to is not null then
      -- Reassign to p_reassign_to where they can see the project; delete
      -- the rest (private project they are not a member of).
      --
      -- UPDATE first: rows that satisfy the visibility predicate.
      -- ON CONFLICT DO NOTHING: if p_reassign_to is already assigned to a
      -- task, skip the duplicate rather than failing.
      insert into task_assignees (task_id, user_id, assigned_by, created_at)
      select ta.task_id, p_reassign_to, null, now()
        from task_assignees ta
        join tasks          t   on t.id  = ta.task_id
        join projects       p   on p.id  = t.project_id
        join workspace_members rw
          on rw.workspace_id = p.workspace_id
         and rw.user_id      = p_reassign_to
         and rw.status       = 'active'
       where ta.user_id       = v_user_id
         and p.workspace_id   = p_workspace_id
         -- Visibility: owner/admin always see it; non-guest/client see
         -- workspace-visible projects; explicit project members see it too.
         and (
           rw.role in ('owner', 'admin')
           or (
             rw.role not in ('guest', 'client')
             and p.visibility = 'workspace'
           )
           or exists (
             select 1
               from project_members pm
              where pm.project_id = p.id
                and pm.user_id    = p_reassign_to
           )
         )
      on conflict (task_id, user_id) do nothing;

      -- Delete the removed member's assignment rows in this workspace
      -- (both the successfully reassigned ones and the unvisible ones).
      delete from task_assignees ta
       using tasks    t,
             projects p
       where ta.user_id     = v_user_id
         and ta.task_id     = t.id
         and t.project_id   = p.id
         and p.workspace_id = p_workspace_id;

      -- Legacy tasks.assignee_id column (deprecated by F159 / AS-286 but
      -- still populated). Apply the same visibility-aware logic: only
      -- point assignee_id at p_reassign_to when they can see the project.
      update tasks t
         set assignee_id = case
               when (
                 -- reassignee is active member with visibility
                 exists (
                   select 1
                     from workspace_members rw2
                     join projects p2 on p2.id = t.project_id
                    where rw2.workspace_id = p2.workspace_id
                      and rw2.user_id      = p_reassign_to
                      and rw2.status       = 'active'
                      and (
                        rw2.role in ('owner', 'admin')
                        or (
                          rw2.role not in ('guest', 'client')
                          and p2.visibility = 'workspace'
                        )
                        or exists (
                          select 1
                            from project_members pm2
                           where pm2.project_id = p2.id
                             and pm2.user_id     = p_reassign_to
                        )
                      )
                 )
               ) then p_reassign_to
               else null
             end
        from projects p3
       where t.assignee_id  = v_user_id
         and t.project_id   = p3.id
         and p3.workspace_id = p_workspace_id;

    else
      -- No reassignee: just unassign.
      delete from task_assignees ta
       using tasks    t,
             projects p
       where ta.user_id     = v_user_id
         and ta.task_id     = t.id
         and t.project_id   = p.id
         and p.workspace_id = p_workspace_id;

      update tasks t
         set assignee_id = null
        from projects p
       where t.assignee_id   = v_user_id
         and t.project_id    = p.id
         and p.workspace_id  = p_workspace_id;
    end if;

  end if;
  -- ── End assignment cleanup ──────────────────────────────────────────────

  delete from workspace_members
   where id           = p_membership_id
     and workspace_id = p_workspace_id
     and status       = 'active';

  return query select true, null::text;
end;
$$;

revoke all on function public.remove_workspace_member(uuid, uuid, uuid) from public;
grant execute on function public.remove_workspace_member(uuid, uuid, uuid)
  to authenticated, service_role;
