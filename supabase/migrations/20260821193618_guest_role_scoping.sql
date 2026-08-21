-- F134: guest role scoping (AS-220, AS-221, AS-222, AS-223, AS-237).
--
-- F132's is_project_visible_to(uuid) / is_project_visible_to_row(uuid,
-- uuid, text) currently grant every active workspace member the
-- "workspace-wide visibility" branch (`visibility = 'workspace'`) as well
-- as an owner/admin bypass. A 'guest' workspace role (added by F126's
-- workspace_members_role_expansion migration, still with no actual
-- scoping) must NOT get either of those branches: a guest sees only
-- projects where they have an explicit project_members row, full stop,
-- regardless of that project's visibility setting.
--
-- Both functions are updated in the same migration and given the exact
-- same guest branch, per this feature's explicit caution: shipping the
-- guard in only one of the two would leave the other as a bypassable
-- fallback (the same "two variants, both need the fix" note the feature
-- spec itself calls out).
--
-- IMPORTANT (regression class to avoid, per orchestrator's caution): do
-- NOT reintroduce a self-referencing subquery against `projects` inside
-- is_project_visible_to_row — that's exactly the same-command RETURNING
-- bug 20260821150000_fix_project_select_returning_regression.sql fixed.
-- This migration only rewires the *role* condition using values already
-- passed in / already resolved via the `projects p` join in
-- is_project_visible_to(uuid) — no new subquery against `projects` is
-- added to either function.

create or replace function public.is_project_visible_to(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        (
          wm.role <> 'guest'
          and (
            p.visibility = 'workspace'
            or wm.role in ('owner', 'admin')
          )
        )
        or exists (
          select 1
          from project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.is_project_visible_to_row(
  target_project_id uuid,
  target_workspace_id uuid,
  target_visibility text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        (
          wm.role <> 'guest'
          and (
            target_visibility = 'workspace'
            or wm.role in ('owner', 'admin')
          )
        )
        or exists (
          select 1
          from project_members pm
          where pm.project_id = target_project_id
            and pm.user_id = auth.uid()
        )
      )
  );
$$;

-- Both function signatures, grants, and the policies that call them
-- (projects_select_active_members, tasks_select_active_members,
-- comments_select_active_members, attachments_select_active_members,
-- attachments_objects_select_active_members, time_entries_select_active_
-- members, checklist_items_*, task_dependencies_*) are unchanged —
-- `create or replace function` keeps the same name/signature/grants, so
-- no policy needs to be redefined.

-- ---------------------------------------------------------------------
-- Invite-as-guest-of-a-project: an invite can carry an optional project
-- to scope the invitee into on acceptance (this feature's "Invite flow"
-- scope item). Additive column on workspace_members, mirroring the
-- existing invited_email pattern: set at invite-creation time, read once
-- by the accept path, left in place afterward as an audit trail (not
-- cleared), never governs access itself (project_members does).
-- ---------------------------------------------------------------------

alter table public.workspace_members
  add column if not exists invited_project_id uuid references public.projects (id);
