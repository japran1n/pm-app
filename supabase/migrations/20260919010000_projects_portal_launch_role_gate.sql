-- F006k (missions/20260903-portal, M1 remediation round 2): role-gate
-- portal_enabled and the launch fields against direct writes (AS-007).
--
-- The defect: projects_update_active_members (20260818004709:45) lets any
-- ACTIVE workspace member update ANY column of any project — the policy
-- was written for name/description/dates (AS-029, "any member, not just
-- admins") and later a BEFORE UPDATE trigger
-- (enforce_project_visibility_change_role, 20260821140526) was added to
-- narrow `visibility` specifically, without narrowing the RLS policy
-- itself. F001 (20260909010000) then added portal_enabled/
-- portal_enabled_at/target_launch_date/launch_confidence/launch_note to
-- this same table and never re-read that write policy or extended that
-- trigger. `client` and `viewer` are active workspace members, so a
-- client can PATCH /rest/v1/projects?id=eq.<any project in their
-- workspace> directly and set portal_enabled = true on a project that
-- isn't theirs to turn on, then read its phases/tasks/pages/requests
-- through the exact gate F006b/F006h/F006i exist to enforce.
--
-- Fix, per this feature's spec: match the existing visibility trigger's
-- shape (a BEFORE UPDATE trigger; RLS's USING/WITH CHECK apply to the
-- whole row, not a column, so a column-level gate has to live in a
-- trigger, not the policy) rather than inventing a second mechanism.
-- Two column groups, two deliberately different role bars:
--
--   - portal_enabled / portal_enabled_at decide what an external party
--     (a client) can see at all — the same blast radius as `visibility`,
--     which is already owner/admin-gated by
--     enforce_project_visibility_change_role. Held to the identical bar
--     (`role in ('owner', 'admin')`).
--   - target_launch_date / launch_confidence / launch_note are ordinary
--     project management fields (the "when does this ship, how confident
--     are we" fields a lead or PM fills in) — not a visibility gate.
--     Held to the "writer" bar already established for this schema's
--     other project-scoped write policies: `role not in ('viewer',
--     'client')` (public.is_project_workspace_writer,
--     20260908010000:71-83 / 20260821194500's original definition) —
--     guest/member/admin/owner may write, viewer/client may not. Not
--     flattened to the owner/admin bar just because one trigger now
--     covers both groups.
--
-- AS-029 (any active member, including an ordinary `member`, can edit a
-- project's name/description/dates) is untouched: this trigger only
-- fires when one of the five named columns actually changes value, and
-- name/description/start/end are not among them.
--
-- Matches enforce_project_visibility_change_role's own shape: SECURITY
-- DEFINER, `auth.role() <> 'service_role'` exemption for the admin
-- client (this codebase's only privileged, RLS-bypassing write path —
-- lib/supabase/admin.ts), same '42501' (insufficient_privilege) errcode.
-- Newly authored, so pins `search_path = public, pg_temp` per this
-- schema's now-established convention for SECURITY DEFINER functions
-- that sit on an authorization boundary (20260908010000, 20260909010000,
-- 20260918010000) — the older visibility trigger predates that lesson
-- and is left as-is; not this feature's scope to touch it.

create or replace function public.enforce_project_portal_and_launch_field_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if (
    new.portal_enabled is distinct from old.portal_enabled
    or new.portal_enabled_at is distinct from old.portal_enabled_at
  ) then
    if not exists (
      select 1
      from workspace_members wm
      where wm.workspace_id = new.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    ) then
      raise exception 'Only workspace owners or admins can change a project''s portal settings'
        using errcode = '42501';
    end if;
  end if;

  if (
    new.target_launch_date is distinct from old.target_launch_date
    or new.launch_confidence is distinct from old.launch_confidence
    or new.launch_note is distinct from old.launch_note
  ) then
    if not exists (
      select 1
      from workspace_members wm
      where wm.workspace_id = new.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role not in ('viewer', 'client')
    ) then
      raise exception 'Only workspace members with write access can change a project''s launch fields'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists projects_enforce_portal_and_launch_field_role on projects;
create trigger projects_enforce_portal_and_launch_field_role
  before update on projects
  for each row
  execute function public.enforce_project_portal_and_launch_field_role();
