-- F021b (missions/20260903-portal, M4 remediation -- blocker): the
-- portal's hours view aggregates across EVERY budget period a project
-- has ever had (the page's own `WIDE_FROM = "2000-01-01"`), while
-- `sold_minutes` comes from a single budget chosen by overlap. A
-- project with a closed 2025 budget (40h used) and a current 2026
-- budget (5h of 40h used) reported Used 45h, Remaining 0h, "+5h Over" --
-- every tile wrong, in the direction that starts a false conversation
-- about an overrun.
--
-- Fix: a new function, `project_current_budget_period`, picks exactly
-- ONE period -- the one covering today, or the most recently ended one
-- if none is current -- and returns its bounds plus whether the project
-- has other (past) periods at all, so the page can query
-- `project_hours_client` with that period's own [period_start,
-- period_end] instead of an unbounded "since the beginning of time"
-- window, and can tell the client plainly that older periods exist
-- rather than silently summing them in. It does not read
-- `project_budgets` directly for the client -- same "no client SELECT
-- policy on this table, only through a SECURITY DEFINER function that
-- exposes exactly what a client may see" rule this table's own
-- migration (20261010010000) already established for `sold_minutes`.
--
-- Routed through `client_gate`, same predicate `project_hours_client`
-- itself uses (20261001010000:130-148).
create or replace function public.project_current_budget_period(
  p_project_id uuid
)
returns table (
  period_start date,
  period_end date,
  has_other_periods boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_period_start date;
  v_period_end date;
  v_total_periods integer;
begin
  if not public.client_gate(p_project_id, p_require_client_role => true) then
    raise exception 'project_current_budget_period: not permitted' using errcode = '42501';
  end if;

  select count(*) into v_total_periods
  from project_budgets pb
  where pb.project_id = p_project_id;

  if v_total_periods = 0 then
    return;
  end if;

  -- The period covering today, if one exists. `project_budgets_no_overlap`
  -- guarantees at most one row can match.
  select pb.period_start, pb.period_end
  into v_period_start, v_period_end
  from project_budgets pb
  where pb.project_id = p_project_id
    and pb.period_start <= current_date
    and pb.period_end >= current_date;

  if v_period_start is null then
    -- No period covers today: fall back to the most recently ended one.
    -- (A project with only a future, not-yet-started budget falls back
    -- to the most recently started one instead, so it still gets a
    -- single, real period rather than none at all.)
    select pb.period_start, pb.period_end
    into v_period_start, v_period_end
    from project_budgets pb
    where pb.project_id = p_project_id
      and pb.period_end < current_date
    order by pb.period_end desc
    limit 1;

    if v_period_start is null then
      select pb.period_start, pb.period_end
      into v_period_start, v_period_end
      from project_budgets pb
      where pb.project_id = p_project_id
      order by pb.period_start desc
      limit 1;
    end if;
  end if;

  return query select v_period_start, v_period_end, v_total_periods > 1;
end;
$$;

comment on function public.project_current_budget_period(uuid) is
  'F021b: picks exactly ONE budget period for the portal hours view -- the one covering today, or the most recently ended one if none is current -- so project_hours_client can be queried with that single period''s own bounds instead of an unbounded range. Returns no rows if the project has no budget at all. has_other_periods lets the page disclose that older periods exist without exposing their data (no client SELECT policy on project_budgets, matching this table''s own migration).';

revoke all on function public.project_current_budget_period(uuid) from public;
grant execute on function public.project_current_budget_period(uuid) to authenticated;
