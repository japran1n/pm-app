-- F116 follow-up: generate_due_recurring_occurrences() (last redefined
-- by 20260822231000_recurrence_scheduled_generation_activity.sql, read
-- in full immediately before writing this) never selected or carried
-- forward the source task's own task_type_id, so every scheduled
-- occurrence it generates would otherwise fall through to
-- `tasks_default_task_type`'s generic 'delivery' default — silently
-- misclassifying a recurring task of any other type (e.g. a recurring
-- 'client_request'). Recreated in full (CREATE OR REPLACE replaces the
-- whole body), unchanged except adding `t.task_type_id` to the SELECT
-- and `v_task.task_type_id` to the INSERT.
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
           t.recurrence, t.recurrence_parent_id, t.task_type_id
    from tasks t
    join projects p on p.id = t.project_id
    where t.recurrence is not null
      and t.due_date is not null
      -- gate on the task's OWN due_date having arrived, not the computed
      -- next date (fixed in 20260822161000; unchanged here).
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
    -- tasks_recurrence_occurrence_idempotency.
    insert into tasks (
      project_id, title, description, description_json, status, priority,
      estimate_minutes, due_date, author_id, position, recurrence,
      recurrence_parent_id, task_type_id
    )
    values (
      v_task.project_id, v_task.title, v_task.description, v_task.description_json,
      'todo', v_task.priority, v_task.estimate_minutes, v_next_due, v_task.author_id,
      v_new_position, v_task.recurrence, v_root_id, v_task.task_type_id
    )
    on conflict (recurrence_parent_id, due_date) do nothing
    returning id into v_new_id;

    if v_new_id is null then
      continue;
    end if;

    -- F176's clone allow-list, ported: checklist items and assignees.
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

    -- F195 follow-up (AS-360): system-attributed task_activity entry for
    -- the newly generated occurrence, mirroring generate-next-occurrence
    -- .ts's own write exactly.
    begin
      perform public.write_task_activity_entry(
        p_task_id  := v_new_id,
        p_kind     := 'field_changed',
        p_field    := 'due_date',
        p_old_value := null,
        p_new_value := to_jsonb(v_next_due),
        p_system   := true
      );
    exception when others then
      raise warning
        'generate_due_recurring_occurrences: write_task_activity_entry failed for task % (non-fatal): %',
        v_new_id, sqlerrm;
    end;

    v_generated_count := v_generated_count + 1;
  end loop;

  return v_generated_count;
end;
$$;

revoke all on function public.generate_due_recurring_occurrences() from public;
grant execute on function public.generate_due_recurring_occurrences() to postgres, service_role;
