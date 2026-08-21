-- F132 fix: the AS-229 visibility-change trigger
-- (public.enforce_project_visibility_change_role, added in
-- 20260821140526_project_visibility_rls_sweep.sql) must not block the
-- admin/service_role client, which this codebase's tests and read-only
-- lookups use and which bypasses RLS by design (lib/supabase/admin.ts).
-- auth.uid() is null under service_role, so the original trigger rejected
-- even a legitimate service_role write. Adds an explicit
-- auth.role() <> 'service_role' guard.

create or replace function public.enforce_project_visibility_change_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility is distinct from old.visibility and auth.role() <> 'service_role' then
    if not exists (
      select 1
      from workspace_members wm
      where wm.workspace_id = new.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    ) then
      raise exception 'Only workspace owners or admins can change a project''s visibility'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
