-- F023 (missions/20260903-portal, M5 — Portal: Your site view, launch day
-- card): adds `projects.warranty_until` / `projects.warranty_terms`, the
-- two columns the feature spec names explicitly ("read from ... and
-- `projects.warranty_until` (added here, with `warranty_terms`)").
--
-- Same shape as F001's own launch fields (20260909010000): both nullable
-- (a project with no warranty set is a real, common state, not an error —
-- rendered as "-" by the view, never a fake date), `warranty_until` a
-- plain date, `warranty_terms` free text (the plain-English scope of what
-- the warranty covers).
alter table projects add column if not exists warranty_until date;
alter table projects add column if not exists warranty_terms text;

-- Role-gate the two new columns the same way F006k
-- (enforce_project_portal_and_launch_field_role, 20260919010000) already
-- gates target_launch_date/launch_confidence/launch_note: ordinary
-- project-management fields, held to the "writer" bar (guest/member/
-- admin/owner may write; viewer/client may not) rather than the tighter
-- owner/admin bar reserved for portal_enabled itself. Extending that
-- existing function (create or replace, matching its own header's
-- "Newly authored ... pins search_path" convention) rather than adding a
-- second trigger, so there is one place — not two — that answers "who
-- can change a project's launch/warranty fields".
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
    or new.warranty_until is distinct from old.warranty_until
    or new.warranty_terms is distinct from old.warranty_terms
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
