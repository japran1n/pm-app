-- Audit hardening (2026-09-13 audit, findings SEC-003 and SEC-005).
--
-- SEC-003 (anon half): 18 SECURITY DEFINER helper predicates were callable
-- by `anon` via PostgREST /rest/v1/rpc/*, making them unauthenticated
-- enumeration oracles (probe whether a uuid is a real workspace/project/
-- task with members). No RLS policy applies to `anon` anywhere (verified:
-- zero policies with anon/public in roles), so nothing legitimate loses
-- access. `authenticated` keeps EXECUTE — policies and app code still call
-- them normally.
revoke execute on function public.can_modify_comment(uuid) from anon;
revoke execute on function public.is_active_workspace_member(uuid) from anon;
revoke execute on function public.is_project_client(uuid) from anon;
revoke execute on function public.is_project_lead_or_workspace_admin(uuid) from anon;
revoke execute on function public.is_project_portal_enabled(uuid) from anon;
revoke execute on function public.is_project_visible_to(uuid) from anon;
revoke execute on function public.is_project_visible_to_row(uuid, uuid, text) from anon;
revoke execute on function public.is_project_workspace_admin(uuid) from anon;
revoke execute on function public.is_project_workspace_member(uuid) from anon;
revoke execute on function public.is_project_workspace_writer(uuid) from anon;
revoke execute on function public.is_task_client(uuid) from anon;
revoke execute on function public.is_task_visible_to(uuid) from anon;
revoke execute on function public.is_task_workspace_member(uuid) from anon;
revoke execute on function public.is_task_workspace_writer(uuid) from anon;
revoke execute on function public.is_workspace_admin(uuid) from anon;
revoke execute on function public.is_workspace_client(uuid) from anon;
revoke execute on function public.shares_non_client_workspace_with(uuid) from anon;
revoke execute on function public.shares_workspace_with(uuid) from anon;

-- SEC-005: workspace_slug_history was SELECT-able by every authenticated
-- user (`using (true)`) — cross-tenant enumeration of historical workspace
-- slugs. Scope reads to members of the workspace the slug belonged to; the
-- redirect lookup only ever happens for a workspace the visitor can reach.
drop policy if exists workspace_slug_history_select_authenticated
  on public.workspace_slug_history;
create policy workspace_slug_history_select_members
  on public.workspace_slug_history
  for select
  to authenticated
  using (public.is_active_workspace_member(workspace_id));
