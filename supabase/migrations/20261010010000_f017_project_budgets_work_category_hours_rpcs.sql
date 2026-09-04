-- F017 (missions/20260903-portal, M4 — opens the milestone): project
-- budgets, a work-category column on time_entries, and two hours RPCs.
--
-- The rule that shapes this feature (its own spec, verbatim): there are
-- TWO read paths for hours, not one with a flag. A single RPC with an
-- `is_client` parameter is one wrong boolean away from handing a client
-- the note field on every time entry -- and notes are where people write
-- "redoing this because we misread the brief". Two functions, two
-- grants, two tests. The duplication is the point.
--
-- ---------------------------------------------------------------------
-- 1. project_budgets (AS-033)
-- ---------------------------------------------------------------------
-- Named `project_budgets` rather than `retainers` per the spec: the
-- first use is a fixed-scope website build, and a retainer is one shape
-- this table takes, not the only one.
--
-- Overlapping periods for one project are rejected by an EXCLUDE
-- constraint (not just app-level validation) -- two live budgets is an
-- unanswerable "how many hours are left". `btree_gist` is required for
-- an equality column (`project_id`) inside an EXCLUDE USING gist
-- alongside a range operator; no migration in this schema has needed it
-- before this one (checked: no `create extension` for it and no
-- `EXCLUDE USING` anywhere in supabase/migrations).
create extension if not exists btree_gist;

create table if not exists project_budgets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  sold_minutes integer not null check (sold_minutes > 0),
  currency text,
  rate_amount numeric,
  rollover text not null default 'none' check (rollover in ('none', 'next_period', 'unlimited')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_budgets_period_valid check (period_end >= period_start),
  -- AS-033's "unanswerable how many hours are left" defect, closed
  -- structurally: no two rows for the same project may have overlapping
  -- [period_start, period_end] ranges (inclusive both ends, matching
  -- the plain `date`/`date` columns the spec asks for rather than a
  -- half-open range type).
  constraint project_budgets_no_overlap exclude using gist (
    project_id with =,
    daterange(period_start, period_end, '[]') with &&
  )
);

create index if not exists project_budgets_project_id_idx on project_budgets (project_id);

drop trigger if exists project_budgets_set_updated_at on project_budgets;
create trigger project_budgets_set_updated_at
  before update on project_budgets
  for each row
  execute function set_updated_at();

alter table project_budgets enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as time_entries
-- (20260818151501) and every other team-owned table in this schema --
-- the app never connects as the table owner for reads.

-- Team read/write only, mirroring project_phases_select_team /
-- _insert_team / _update_team / _delete_team
-- (supabase/migrations/20260909010000_portal_foundations.sql:141-182).
-- Deliberately NO client SELECT policy: the spec's "two read paths, not
-- one with a flag" rule means a client never reads this table directly
-- -- `sold_minutes` for a period reaches the portal only through
-- `project_hours_client` below, a SECURITY DEFINER function that
-- selects exactly one column client-side. A client policy here would be
-- a second, redundant path to the same data with its own chance to
-- diverge.
drop policy if exists project_budgets_select_team on project_budgets;
create policy project_budgets_select_team
  on project_budgets
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_budgets_insert_team on project_budgets;
create policy project_budgets_insert_team
  on project_budgets
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_budgets_update_team on project_budgets;
create policy project_budgets_update_team
  on project_budgets
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_budgets_delete_team on project_budgets;
create policy project_budgets_delete_team
  on project_budgets
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 2. time_entries.work_category
-- ---------------------------------------------------------------------
-- Nullable per the spec: backfilling six months of entries with a guess
-- is worse than an honest "uncategorised" bucket. New entries get a
-- default proposed from the task's type in the team UI (F018) and are
-- editable there -- this migration only adds the column and its
-- constraint.
alter table time_entries add column if not exists work_category text;

alter table time_entries drop constraint if exists time_entries_work_category_check;
alter table time_entries add constraint time_entries_work_category_check
  check (work_category in ('design', 'development', 'content_seo', 'pm', 'qa'));

-- ---------------------------------------------------------------------
-- 3. Two RPCs. Both pin `search_path` with `pg_temp`
--    (matching 20260908010000's convention for every SECURITY DEFINER
--    predicate in this mission).
-- ---------------------------------------------------------------------

-- project_hours_team: everything -- billable and not, per person, per
-- category, notes included. Team-only: routed through
-- is_project_visible_to + NOT is_project_client, the same "team, not
-- client" shape project_phases_select_team already uses, re-checked
-- explicitly in the body because SECURITY DEFINER bypasses RLS (this
-- table's own time_entries_select_active_members policy is not consulted
-- here, matching every other client/team split RPC in this mission --
-- see client_gate's own header, 20261001010000:130-148, for why the
-- check has to live in the function body rather than being left to RLS).
create or replace function public.project_hours_team(
  p_project_id uuid,
  p_from date,
  p_to date
)
returns table (
  entry_id uuid,
  user_id uuid,
  task_id uuid,
  task_title text,
  entry_date date,
  minutes integer,
  billable boolean,
  work_category text,
  note text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_project_visible_to(p_project_id) or public.is_project_client(p_project_id) then
    raise exception 'project_hours_team: not permitted' using errcode = '42501';
  end if;

  return query
  select
    te.id,
    te.user_id,
    te.task_id,
    t.title,
    te.entry_date,
    te.minutes,
    te.billable,
    te.work_category,
    te.note
  from time_entries te
  join tasks t on t.id = te.task_id
  where t.project_id = p_project_id
    and t.deleted_at is null
    and te.entry_date >= p_from
    and te.entry_date <= p_to
  order by te.entry_date, te.user_id;
end;
$$;

comment on function public.project_hours_team(uuid, date, date) is
  'F017: the team hours read path -- billable and non-billable, per person, per category, with the task title and the entry note included. Team-only (not client), re-checked in the body since SECURITY DEFINER bypasses RLS. Deliberately a separate function from project_hours_client rather than the same function with a flag -- see this migration''s own header.';

revoke all on function public.project_hours_team(uuid, date, date) from public;
grant execute on function public.project_hours_team(uuid, date, date) to authenticated;

-- project_hours_client: AS-035, AS-036, AS-037. Returns ONLY: totals by
-- ISO week (per-week and cumulative), billable only; totals by
-- work_category, billable only, with uncategorised as its own labelled
-- bucket; and the budget's sold_minutes for the period. It returns no
-- person, no note, and no task title -- AS-037 is satisfied
-- structurally, not by filtering: this query never selects
-- `tasks.title` (or any other task column) at all, for any task, so a
-- client-invisible task's name cannot leak through it regardless of
-- that task's own client_visible value. That is the stronger, easier-
-- to-prove shape the spec asks for over filtering titles by visibility.
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

  -- Weekly totals, billable only. Note: this query touches `tasks` only
  -- to scope by project_id/deleted_at -- it never selects a task column
  -- into the result.
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
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'iso_week', iso_week,
        'minutes', minutes,
        'cumulative_minutes', sum(minutes) over (order by iso_week rows between unbounded preceding and current row)
      )
      order by iso_week
    ),
    '[]'::jsonb
  )
  into v_weekly
  from weekly;

  -- Totals by work_category, billable only, uncategorised as its own
  -- labelled bucket.
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

  -- The budget covering this period. project_budgets_no_overlap
  -- guarantees at most one row per project can contain any given date,
  -- so if [p_from, p_to] stays inside one budget period there is at
  -- most one match; if the requested range straddles a boundary
  -- between two adjacent budgets, the most recently starting one wins
  -- (there is no single correct answer for "the" budget of a range
  -- spanning two periods, and the spec's own primary success test uses
  -- a range inside one period).
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
  'F017: the client hours read path (AS-035, AS-036, AS-037). Returns weekly totals (per-week + cumulative), by-category totals, and the period''s sold_minutes -- billable entries only, no person, no note, no task title. Never selects a task column into the result at all, so AS-037 holds structurally regardless of any task''s own client_visible value. Deliberately a separate function from project_hours_team -- see this migration''s own header.';

revoke all on function public.project_hours_client(uuid, date, date) from public;
grant execute on function public.project_hours_client(uuid, date, date) to authenticated;
