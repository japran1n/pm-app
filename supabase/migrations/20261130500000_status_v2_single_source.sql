-- Tasks written with a status NAME that isn't one of the project's column
-- names verbatim ('todo', 'done', 'client_input_needed', ...) got a NULL
-- status_id from sync_task_status_and_status_id, and every category-based
-- read (open counts, health, overdue, portal buckets) then treated them as
-- unknown. Several writers still send the pre-v2 names: the recurring
-- cron, restore_task_atomic, template and client-request inserts, and the
-- default 'todo'.
--
-- 1. resolve_project_status_id: one resolver for a status name on a
--    project (exact -> case/space/underscore-insensitive -> legacy v2
--    rename -> first not_started column for a legacy name). Mirrors
--    matchProjectStatusName in lib/tasks/status-category.ts.
-- 2. The sync trigger resolves through it, prefers an explicitly written
--    status_id that belongs to the task's project, re-resolves on a
--    project move, and always stores the column's canonical name.
-- 3. restore_task_atomic and generate_due_recurring_occurrences resolve
--    against the project's columns instead of the legacy four.
-- 4. Backfill NULL status_id where the name resolves without the
--    not_started fallback guess. updated_at is left untouched.

-- ---------------------------------------------------------------------
-- 1. Resolver
-- ---------------------------------------------------------------------

create or replace function public.resolve_project_status_id(p_project_id uuid, p_name text)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select m.id
  from (
    select c.id, c.position,
      case
        when c.name = p_name then 1
        when lower(regexp_replace(btrim(c.name), '[\s_-]+', ' ', 'g'))
           = lower(regexp_replace(btrim(p_name), '[\s_-]+', ' ', 'g')) then 2
        when c.name = case p_name
          when 'todo' then 'To Do'
          when 'in_progress' then 'In Dev'
          when 'in_review' then 'QA by Dev'
          when 'done' then 'Completed'
        end then 3
        when p_name in ('todo', 'in_progress', 'in_review', 'done')
          and c.category = 'not_started' then 4
      end as rank
    from project_statuses c
    where c.project_id = p_project_id
  ) m
  where m.rank is not null
  order by m.rank, m.position
  limit 1;
$$;

revoke all on function public.resolve_project_status_id(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_project_status_id(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 2. Sync trigger
-- ---------------------------------------------------------------------

create or replace function public.sync_task_status_and_status_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_changed boolean;
  v_status_id_changed boolean;
  v_project_changed boolean;
  v_name text;
begin
  v_status_changed := tg_op = 'INSERT' or new.status is distinct from old.status;
  v_status_id_changed := tg_op = 'INSERT' or new.status_id is distinct from old.status_id;
  v_project_changed := tg_op = 'UPDATE' and new.project_id is distinct from old.project_id;

  if v_status_id_changed and new.status_id is not null
     and exists (
       select 1 from project_statuses ps
       where ps.id = new.status_id and ps.project_id = new.project_id
     ) then
    null;
  elsif (v_status_changed or v_project_changed) and new.status is not null then
    new.status_id := public.resolve_project_status_id(new.project_id, new.status);
  end if;

  if new.status_id is not null
     and (v_status_changed or v_status_id_changed or v_project_changed) then
    select ps.name into v_name from project_statuses ps where ps.id = new.status_id;
    if v_name is not null then
      new.status := v_name;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Writers that assumed the legacy four
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.restore_task_atomic(p_task_id uuid)
 RETURNS TABLE(id uuid, project_id uuid, status text, "position" double precision, status_was_reset boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_project_id uuid;
  v_current_status text;
  v_resolved_status text;
  v_status_was_reset boolean;
  v_last_position float8;
  v_new_position float8;
  v_default_status text;
  v_child record;
  v_child_resolved_status text;
  v_child_last_position float8;
  v_child_position float8;
begin
  if auth.uid() is not null then
    if not public.is_task_workspace_writer(p_task_id) then
      raise exception 'restore_task_atomic: caller does not have write access to this task'
        using errcode = '42501';
    end if;

    if not public.is_project_visible_to(
      (select t.project_id from public.tasks t where t.id = p_task_id)
    ) then
      raise exception 'restore_task_atomic: caller does not have access to this task''s project'
        using errcode = '42501';
    end if;
  end if;

  select t.project_id, t.status
    into v_project_id, v_current_status
  from public.tasks t
  where t.id = p_task_id
    and t.deleted_at is not null
  for update;

  if v_project_id is null then
    return;
  end if;

  v_default_status := coalesce(
    (select ps.name from public.project_statuses ps
      where ps.id = public.resolve_project_status_id(v_project_id, 'todo')),
    'todo'
  );

  select ps.name
    into v_resolved_status
  from public.project_statuses ps
  where ps.id = public.resolve_project_status_id(v_project_id, v_current_status);

  v_status_was_reset := v_resolved_status is null;
  v_resolved_status := coalesce(v_resolved_status, v_default_status);

  select t."position"
    into v_last_position
  from public.tasks t
  where t.project_id = v_project_id
    and t.status = v_resolved_status
    and t.deleted_at is null
  order by t."position" desc
  limit 1;

  v_new_position := coalesce(v_last_position, 0) + 1000;

  update public.tasks
  set deleted_at = null,
      deleted_by = null,
      status = v_resolved_status,
      "position" = v_new_position
  where public.tasks.id = p_task_id;

  for v_child in
    select t.id, t.status
    from public.tasks t
    where t.deleted_via_task_id = p_task_id
      and t.deleted_at is not null
  loop
    v_child_resolved_status := coalesce(
      (select ps.name from public.project_statuses ps
        where ps.id = public.resolve_project_status_id(v_project_id, v_child.status)),
      v_default_status
    );

    select t."position"
      into v_child_last_position
    from public.tasks t
    where t.project_id = v_project_id
      and t.status = v_child_resolved_status
      and t.deleted_at is null
    order by t."position" desc
    limit 1;

    v_child_position := coalesce(v_child_last_position, 0) + 1000;

    update public.tasks
    set deleted_at = null,
        deleted_by = null,
        deleted_via_task_id = null,
        status = v_child_resolved_status,
        "position" = v_child_position
    where public.tasks.id = v_child.id;
  end loop;

  return query
  select p_task_id, v_project_id, v_resolved_status, v_new_position, v_status_was_reset;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_due_recurring_occurrences()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task record;
  v_next_due date;
  v_root_id uuid;
  v_new_id uuid;
  v_new_position double precision;
  v_initial_status text;
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

    v_initial_status := coalesce(
      (select ps.name from project_statuses ps
        where ps.id = public.resolve_project_status_id(v_task.project_id, 'todo')),
      'todo'
    );

    select coalesce(max(position), 0) + 1000
      into v_new_position
      from tasks
      where project_id = v_task.project_id
        and status = v_initial_status
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
      v_initial_status, v_task.priority, v_task.estimate_minutes, v_next_due, v_task.author_id,
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
$function$
;

-- ---------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------

alter table public.tasks disable trigger tasks_set_updated_at;

update public.tasks t
set status_id = public.resolve_project_status_id(t.project_id, t.status)
where t.status_id is null
  and t.status is not null
  and exists (
    select 1 from public.project_statuses c
    where c.project_id = t.project_id
      and (
        c.name = t.status
        or lower(regexp_replace(btrim(c.name), '[\s_-]+', ' ', 'g'))
           = lower(regexp_replace(btrim(t.status), '[\s_-]+', ' ', 'g'))
        or c.name = case t.status
          when 'todo' then 'To Do'
          when 'in_progress' then 'In Dev'
          when 'in_review' then 'QA by Dev'
          when 'done' then 'Completed'
        end
      )
  );

alter table public.tasks enable trigger tasks_set_updated_at;
