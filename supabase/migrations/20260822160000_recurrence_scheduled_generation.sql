-- F178 (AS-322): scheduled, date-driven occurrence generation via
-- Supabase Cron (pg_cron), independent of anyone opening the app or
-- completing a task. Complements F177's on-completion generation
-- (lib/recurrence/generate-next-occurrence.ts, called from
-- moveTaskStatus) with a second, time-based trigger for series whose next
-- due date has simply arrived on the calendar, whether or not the current
-- occurrence was ever marked done.
--
-- Per this feature's Clarified implementation / spec: job registration
-- must live in a migration (reproducible on a fresh project), not be
-- clicked into the dashboard, and the SQL date math must implement the
-- SAME rules as F176's TypeScript `lib/recurrence/next-date.ts`
-- (`nextOccurrenceDate`) -- ported carefully below, with parity asserted
-- by `tests/integration/recurrence-sql-parity.test.ts` running
-- representative cases through both implementations.
--
-- Verified pg_cron / Supabase Cron syntax (fetched 2026-08-22 from
-- https://supabase.com/docs/guides/cron/install and
-- https://supabase.com/docs/guides/cron/quickstart -- current docs, not
-- training-data memory, per this mission's version-freshness rule):
--   create extension pg_cron with schema pg_catalog;
--   grant usage on schema cron to postgres;
--   grant all privileges on all tables in schema cron to postgres;
--   select cron.schedule('job-name', '<pg_cron schedule>', 'SELECT some_function()');
-- tech-decisions.md already settled on "Supabase Cron (pg_cron, enabled by
-- default on all plans) calling a Postgres function directly" for exactly
-- this feature (recurring tasks) as of 2026-08-18 -- this migration is
-- that decision made reproducible. The extension is enabled by default on
-- Supabase, but this migration still enables it explicitly (idempotently)
-- so a fresh project reproduces the same state, per this feature's own
-- Notes for clarification.
--
-- NOTE: `generate_due_recurring_occurrences`'s trigger condition below was
-- corrected in a same-session follow-up
-- (20260822161000_recurrence_scheduled_generation_fix.sql) before this
-- feature's handoff was written -- see that file's own comment for the
-- bug and the fix. Left here unmodified as the historical record of what
-- was actually applied first; `create or replace function` in the
-- follow-up is what a fresh project ends up running.

create extension if not exists pg_cron with schema pg_catalog;

-- Supabase manages the `postgres` role's cron privileges on hosted
-- projects already; these grants are still issued explicitly (and
-- idempotently -- GRANT is safe to repeat) so a fresh/self-hosted project
-- reproduces the same access without a manual dashboard step.
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- ---------------------------------------------------------------------
-- Date math: SQL port of lib/recurrence/next-date.ts's nextOccurrenceDate.
-- ---------------------------------------------------------------------
--
-- Ported rules (must match the TypeScript implementation's documented
-- behaviour exactly -- see next-date.ts's own top-of-file comment):
--   - daily / every_n_days: fromDate + interval days.
--   - weekly: fromDate + (interval * 7) days.
--   - monthly: fromDate + interval months, CLAMPED to the target month's
--     last day (Jan 31 + 1 month -> Feb 28/29, never overflows into
--     March) -- date-fns's addMonths clamps natively; Postgres's own
--     `date + interval 'N months'` does NOT (it overflows into the next
--     month instead), so the clamp is hand-rolled here to match.
--   - `until` is an INCLUSIVE boundary (a computed next date equal to
--     `until` is still valid; only strictly-after returns null), matching
--     next-date.ts's documented AUTONOMOUS_DECISION (F176 handoff).
--   - Invalid input (missing/invalid `freq`, non-positive/non-integer
--     `interval`, unparsable `until`) returns NULL rather than raising --
--     this SQL function is used inside a loop over many tasks in the
--     scheduled job below, and one malformed `recurrence` row must never
--     abort the whole run for every other series.
--
-- Unlike the TypeScript version, this function takes no `timezone`
-- argument: next-date.ts's own comment states timezone only matters for
-- comparing against "today" semantics a caller layers on top of the pure
-- day-count arithmetic itself, which is timezone-agnostic calendar-date
-- maths. This function performs exactly that same timezone-agnostic
-- calendar-date maths (operating on plain `date` values, never
-- timestamps), so no timezone input changes its result -- it is the exact
-- same "arithmetic core" next-date.ts documents, just without the
-- caller-supplied-timezone parameter that only the TypeScript module's
-- `nextOccurrenceDateFromToday` convenience wrapper (not used here) needs.
create or replace function public.recurrence_next_due_date(
  p_rule jsonb,
  p_from_date date
)
returns date
language plpgsql
immutable
as $$
declare
  v_freq text;
  v_interval integer;
  v_until date;
  v_next date;
  v_next_month_start date;
  v_last_day_of_month date;
  v_source_day integer;
  v_clamped_day integer;
begin
  if p_rule is null or p_from_date is null then
    return null;
  end if;

  v_freq := p_rule->>'freq';

  begin
    v_interval := (p_rule->>'interval')::integer;
  exception when others then
    return null;
  end;

  if v_interval is null or v_interval <= 0 then
    return null;
  end if;

  v_until := null;
  if (p_rule ? 'until') and (p_rule->>'until') is not null then
    begin
      v_until := (p_rule->>'until')::date;
    exception when others then
      -- malformed `until` -- invalid input, matches next-date.ts.
      return null;
    end;
  end if;

  case v_freq
    when 'daily' then
      v_next := (p_from_date + (v_interval || ' days')::interval)::date;
    when 'every_n_days' then
      v_next := (p_from_date + (v_interval || ' days')::interval)::date;
    when 'weekly' then
      v_next := (p_from_date + ((v_interval * 7) || ' days')::interval)::date;
    when 'monthly' then
      v_next_month_start := (
        date_trunc('month', p_from_date) + (v_interval || ' months')::interval
      )::date;
      v_last_day_of_month := (
        v_next_month_start + interval '1 month' - interval '1 day'
      )::date;
      v_source_day := extract(day from p_from_date)::integer;
      v_clamped_day := least(v_source_day, extract(day from v_last_day_of_month)::integer);
      v_next := make_date(
        extract(year from v_next_month_start)::integer,
        extract(month from v_next_month_start)::integer,
        v_clamped_day
      );
    else
      return null;
  end case;

  if v_next is null then
    return null;
  end if;

  -- AS-323 (inclusive `until` boundary, same semantics next-date.ts
  -- documents): only a date strictly AFTER `until` is exhausted.
  if v_until is not null and v_next > v_until then
    return null;
  end if;

  return v_next;
end;
$$;

comment on function public.recurrence_next_due_date(jsonb, date) is
  'F178: SQL port of lib/recurrence/next-date.ts''s nextOccurrenceDate. '
  'Must be kept in parity with the TypeScript implementation -- see '
  'tests/integration/recurrence-sql-parity.test.ts, which runs the same '
  'representative cases through both and asserts matching output.';

-- ---------------------------------------------------------------------
-- Generation: SECURITY DEFINER function the cron job calls. Mirrors
-- lib/recurrence/generate-next-occurrence.ts's insert shape (cloned
-- fields per F176's allow-list, idempotency via the same DB-level unique
-- constraint tasks_recurrence_occurrence_idempotency introduced by F177),
-- but is date-driven (fires once a task's own due_date has arrived,
-- i.e. is today or earlier) instead of completion-driven.
--
-- See 20260822161000_recurrence_scheduled_generation_fix.sql for the
-- corrected trigger condition (`t.due_date <= current_date`, not
-- `computed_next_due <= current_date`) actually applied -- this
-- definition is superseded by that file's `create or replace`.
-- ---------------------------------------------------------------------
create or replace function public.generate_due_recurring_occurrences()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_next_due date;
  v_root_id uuid;
  v_new_id uuid;
  v_new_position double precision;
  v_generated_count integer := 0;
begin
  for v_task in
    select t.id, t.project_id, t.title, t.description, t.description_json,
           t.priority, t.estimate_minutes, t.due_date, t.author_id,
           t.recurrence, t.recurrence_parent_id
    from tasks t
    join projects p on p.id = t.project_id
    where t.recurrence is not null
      and t.due_date is not null
      and t.due_date <= current_date
      and t.deleted_at is null
      and p.deleted_at is null
  loop
    v_next_due := public.recurrence_next_due_date(v_task.recurrence, v_task.due_date);

    if v_next_due is null then
      continue;
    end if;

    v_root_id := coalesce(v_task.recurrence_parent_id, v_task.id);

    select coalesce(max(position), 0) + 1000
      into v_new_position
      from tasks
      where project_id = v_task.project_id
        and status = 'todo'
        and deleted_at is null;

    v_new_id := null;

    insert into tasks (
      project_id, title, description, description_json, status, priority,
      estimate_minutes, due_date, author_id, position, recurrence,
      recurrence_parent_id
    )
    values (
      v_task.project_id, v_task.title, v_task.description, v_task.description_json,
      'todo', v_task.priority, v_task.estimate_minutes, v_next_due, v_task.author_id,
      v_new_position, v_task.recurrence, v_root_id
    )
    on conflict (recurrence_parent_id, due_date) do nothing
    returning id into v_new_id;

    if v_new_id is null then
      continue;
    end if;

    insert into checklist_items (task_id, content, position)
    select v_new_id, ci.content, ci.position
    from checklist_items ci
    where ci.task_id = v_task.id
    order by ci.position;

    insert into task_assignees (task_id, user_id, assigned_by)
    select v_new_id, ta.user_id, v_task.author_id
    from task_assignees ta
    where ta.task_id = v_task.id;

    update tasks set last_occurrence_at = now() where id = v_root_id;

    v_generated_count := v_generated_count + 1;
  end loop;

  return v_generated_count;
end;
$$;

comment on function public.generate_due_recurring_occurrences() is
  'F178 (AS-322): generates the next occurrence for every date-driven '
  'recurring task whose OWN due_date has arrived (today or earlier), '
  'independent of anyone opening the app or completing the current '
  'occurrence. SECURITY DEFINER so the pg_cron job (which runs as the '
  'postgres role) can write regardless of the calling context''s RLS -- '
  'there is no human actor/session for a scheduled job to authenticate '
  'as, matching this feature''s Clarified implementation (auth/access- '
  'control answer: "no -- it is pure; permission checks stay in the '
  'action layer", applied here as "the scheduled trigger IS the '
  'authorized caller, by design").';

revoke all on function public.generate_due_recurring_occurrences() from public;
grant execute on function public.generate_due_recurring_occurrences() to postgres, service_role;

-- Schedule: hourly. AUTONOMOUS_DECISION (no interval was pinned by the
-- feature spec or its clarification round) -- date-driven recurrence
-- rules operate at day granularity at the finest (the shortest supported
-- freq is "daily"), so there is no behavioural difference between running
-- every 5 minutes and once an hour: whichever run first sees a due_date
-- that has arrived generates the occurrence, and a single day has 24
-- hourly windows to catch it. Hourly is the simplest option that adds no
-- new dependency, keeps the job comfortably within Supabase Cron's "no
-- more than 8 concurrent jobs, each under 10 minutes" guidance, and
-- avoids needlessly re-scanning the whole recurring-task set every few
-- minutes for a feature whose own precision floor is "once a day".
select cron.schedule(
  'generate-due-recurring-occurrences',
  '0 * * * *',
  $$select public.generate_due_recurring_occurrences();$$
);
