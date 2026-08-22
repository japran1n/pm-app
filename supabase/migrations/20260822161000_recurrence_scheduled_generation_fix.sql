-- F178 follow-up fix within the same feature (same-session, before the
-- handoff was written): the trigger condition in
-- `generate_due_recurring_occurrences` (20260822160000) originally gated
-- on the COMPUTED next date (`recurrence_next_due_date(...) <=
-- current_date`) rather than the task's own recorded `due_date`. That
-- inverted the intended meaning of AS-322 ("whose next date has
-- arrived"): for any interval longer than "already elapsed" (the common
-- case -- e.g. weekly, monthly, or a large every_n_days), the freshly
-- computed next date is itself in the FUTURE, so the original condition
-- skipped every eligible task and generated nothing. Verified against the
-- real linked project with a seeded `every_n_days: 20000` task: the
-- original function generated 0 occurrences where 1 was expected.
--
-- Correct semantics (matching F177's own model: a due_date "arriving" is
-- what should trigger the series to advance -- F177 triggers on
-- completion of the CURRENT occurrence and always writes a future
-- due_date onto the next one; F178 triggers on the CURRENT occurrence's
-- due_date having passed, and likewise always writes whatever date
-- `recurrence_next_due_date` computes, future or not, onto the next row):
--   eligible task: t.due_date <= current_date (the CURRENT occurrence is
--   due/overdue)
--   generated row's due_date: recurrence_next_due_date(t.recurrence,
--   t.due_date) (may legitimately be in the future -- that's just the new
--   occurrence's own upcoming schedule)
--
-- `create or replace function` here supersedes the original definition
-- from 20260822160000 -- a fresh project applying both migrations in
-- order ends up with this corrected body, matching this mission's
-- additive-migration-safety convention (fix forward, don't rewrite
-- history).
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
      -- FIX: gate on the task's OWN due_date having arrived, not the
      -- computed next date (see this file's top comment).
      and t.due_date <= current_date
      and t.deleted_at is null
      and p.deleted_at is null
  loop
    v_next_due := public.recurrence_next_due_date(v_task.recurrence, v_task.due_date);

    -- No further occurrence -- invalid/malformed rule, or the series is
    -- exhausted (past `until`, AS-323).
    if v_next_due is null then
      continue;
    end if;

    -- Series root, never the immediately-due task -- same convention
    -- generate-next-occurrence.ts documents, so repeated generations
    -- across the same series all collide against ONE
    -- recurrence_parent_id value in the shared unique constraint.
    v_root_id := coalesce(v_task.recurrence_parent_id, v_task.id);

    select coalesce(max(position), 0) + 1000
      into v_new_position
      from tasks
      where project_id = v_task.project_id
        and status = 'todo'
        and deleted_at is null;

    v_new_id := null;

    -- Same idempotency guarantee AS-320/F177 already established:
    -- ON CONFLICT (recurrence_parent_id, due_date) DO NOTHING against
    -- tasks_recurrence_occurrence_idempotency. This absorbs both a
    -- same-run double count and the case where F177's on-completion path
    -- already generated this exact occurrence before this job ran.
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

    -- F176's clone allow-list, ported: checklist items (content/position
    -- only -- always fresh/unchecked, same as generate-next-occurrence.ts)
    -- and assignees (user_id only; assigned_by is the series' own
    -- author_id, since this is a system-generated occurrence with no
    -- acting human user).
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
  'authorized caller, by design"). Fixed in '
  '20260822161000_recurrence_scheduled_generation_fix.sql -- see that '
  'migration''s comment for the bug/fix history.';

-- Grants are idempotent (safe to repeat) -- restated here so this
-- migration is self-contained if ever read in isolation.
revoke all on function public.generate_due_recurring_occurrences() from public;
grant execute on function public.generate_due_recurring_occurrences() to postgres, service_role;
