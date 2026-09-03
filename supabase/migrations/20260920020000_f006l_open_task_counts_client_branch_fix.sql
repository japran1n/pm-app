-- Follow-up to 20260920010000_f006l_bypass_paths.sql, applied within the
-- same worker session: `is_project_visible_to` deliberately excludes the
-- `client` role (20260908010000/20260902010000), so gating
-- `get_open_task_counts` on it unconditionally made the function return
-- zero rows for a client of a portal-ENABLED project too, not just a
-- disabled one. Splits the predicate into a client branch (portal_enabled
-- + client_visible, the portal's own rule) and a non-client branch
-- (ordinary is_project_visible_to), matching every other portal-aware
-- predicate in this schema (e.g. project_phases_select_client vs
-- project_phases_select_team, 20260909010000).
--
-- Body is otherwise identical to 20260920010000's definition; this file
-- exists only because that migration was already recorded in the ledger
-- before this correction, and 20260920010000's own source has been
-- updated in place to match, so a fresh environment applying migrations
-- from scratch only ever sees the correct body once.

create or replace function public.get_open_task_counts(project_ids uuid[])
returns table (project_id uuid, open_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return;
  end if;

  return query
  select t.project_id, count(*)::bigint as open_count
  from tasks t
  join project_statuses ps on ps.id = t.status_id
  join projects p on p.id = t.project_id
  where t.project_id = any(project_ids)
    and t.deleted_at is null
    and ps.category != 'done'
    and public.is_active_workspace_member(p.workspace_id)
    and (
      (
        public.is_project_client(t.project_id)
        and public.is_project_portal_enabled(t.project_id)
        and t.client_visible
      )
      or (
        not public.is_project_client(t.project_id)
        and public.is_project_visible_to(t.project_id)
      )
    )
  group by t.project_id;
end;
$$;

revoke all on function public.get_open_task_counts(uuid[]) from public;
grant execute on function public.get_open_task_counts(uuid[]) to authenticated;
