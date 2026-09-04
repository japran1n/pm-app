-- F017b (missions/20260903-portal, M4): fixes a defect in the same
-- feature's own migration (20261010010000), caught by that feature's
-- own primary success test before it was ever committed.
--
-- `jsonb_agg(... cumulative_minutes ...)` tried to nest a window
-- function call (`sum(...) over (...)`) directly inside an aggregate
-- function call in the same select list -- Postgres rejects this
-- outright ("aggregate function calls cannot contain window function
-- calls", 42803). Fix: compute the window function in its own CTE
-- (`weekly_cum`) first, then aggregate that CTE's already-materialized
-- rows with `jsonb_agg` in a separate, later select. Same two-step
-- shape, no other change to project_hours_client's behaviour, grants,
-- or signature.
create or replace function public.project_hours_client(
  p_project_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_weekly jsonb;
  v_category jsonb;
  v_sold_minutes integer;
begin
  if not public.client_gate(p_project_id, p_require_client_role => true) then
    raise exception 'project_hours_client: not permitted' using errcode = '42501';
  end if;

  with billable_entries as (
    select te.entry_date, te.minutes, te.work_category
    from time_entries te
    join tasks t on t.id = te.task_id
    where t.project_id = p_project_id
      and t.deleted_at is null
      and te.billable
      and te.entry_date >= p_from
      and te.entry_date <= p_to
  ),
  weekly as (
    select
      to_char(entry_date, 'IYYY-"W"IW') as iso_week,
      sum(minutes)::integer as minutes
    from billable_entries
    group by 1
  ),
  weekly_cum as (
    select
      iso_week,
      minutes,
      sum(minutes) over (order by iso_week rows between unbounded preceding and current row) as cumulative_minutes
    from weekly
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'iso_week', iso_week,
        'minutes', minutes,
        'cumulative_minutes', cumulative_minutes
      )
      order by iso_week
    ),
    '[]'::jsonb
  )
  into v_weekly
  from weekly_cum;

  with billable_entries as (
    select te.minutes, te.work_category
    from time_entries te
    join tasks t on t.id = te.task_id
    where t.project_id = p_project_id
      and t.deleted_at is null
      and te.billable
      and te.entry_date >= p_from
      and te.entry_date <= p_to
  ),
  by_category as (
    select
      coalesce(work_category, 'uncategorised') as work_category,
      sum(minutes)::integer as minutes
    from billable_entries
    group by 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('work_category', work_category, 'minutes', minutes)
      order by work_category
    ),
    '[]'::jsonb
  )
  into v_category
  from by_category;

  select pb.sold_minutes
  into v_sold_minutes
  from project_budgets pb
  where pb.project_id = p_project_id
    and daterange(pb.period_start, pb.period_end, '[]') && daterange(p_from, p_to, '[]')
  order by pb.period_start desc
  limit 1;

  return jsonb_build_object(
    'weekly', v_weekly,
    'by_category', v_category,
    'sold_minutes', v_sold_minutes
  );
end;
$$;

comment on function public.project_hours_client(uuid, date, date) is
  'F017/F017b: the client hours read path (AS-035, AS-036, AS-037). Returns weekly totals (per-week + cumulative), by-category totals, and the period''s sold_minutes -- billable entries only, no person, no note, no task title. Never selects a task column into the result at all, so AS-037 holds structurally regardless of any task''s own client_visible value. F017b fixed a 42803 (window function nested inside jsonb_agg) that F017''s own primary success test caught before commit -- see this migration''s own header.';

-- CREATE OR REPLACE preserves the existing grants (revoke all from
-- public/anon/authenticated, grant execute to authenticated) from
-- 20261010010000 -- re-stated here anyway per this mission's own
-- "state your grants explicitly" instruction, not left implicit.
revoke all on function public.project_hours_client(uuid, date, date) from public;
grant execute on function public.project_hours_client(uuid, date, date) to authenticated;
