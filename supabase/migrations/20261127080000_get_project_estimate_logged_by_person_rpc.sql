-- P2-16: replace two-round-trip full-scan queries (all tasks + all time_entries
-- for a project) with a single FULL OUTER JOIN aggregation executed server-side.
-- security invoker: RLS on tasks and time_entries still applies.
create or replace function public.get_project_estimate_and_logged_by_person(
  p_project_id uuid
)
returns table (
  user_id uuid,
  estimated_minutes numeric,
  logged_minutes numeric
)
language sql
security invoker
stable
set search_path = public
as $$
  select
    coalesce(e.user_id, l.user_id) as user_id,
    coalesce(e.estimated_minutes, 0) as estimated_minutes,
    coalesce(l.logged_minutes, 0) as logged_minutes
  from (
    select assignee_id as user_id, sum(estimate_minutes) as estimated_minutes
    from public.tasks
    where project_id = p_project_id
      and deleted_at is null
      and assignee_id is not null
    group by assignee_id
  ) e
  full outer join (
    select te.user_id, sum(te.minutes) as logged_minutes
    from public.time_entries te
    join public.tasks t on t.id = te.task_id
    where t.project_id = p_project_id
      and t.deleted_at is null
    group by te.user_id
  ) l on l.user_id = e.user_id;
$$;

revoke all on function public.get_project_estimate_and_logged_by_person(uuid) from public;
grant execute on function public.get_project_estimate_and_logged_by_person(uuid) to authenticated;
