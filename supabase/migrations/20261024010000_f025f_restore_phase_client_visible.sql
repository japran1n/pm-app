-- F025f (missions/20260903-portal, final remediation — AS-012): restores
-- `client_visible` handling in `create_project_from_template`, dropped
-- when 20260927020000 (F013) re-created the function to add
-- `p_deliverables`. F016h (20260917020000) had already fixed exactly
-- this once — `coalesce((v_phase->>'client_visible')::boolean, true)`
-- fed into the `project_phases` insert — and F013's `create or replace`
-- was written from the author's mental model of the function (the
-- pre-F016h shape, matching 20260915010000's original phase insert
-- verbatim) rather than from its actual current body, so the fix was
-- silently dropped. Confirmed by diff: 20260927020000's phase-insert
-- loop inserts only `(project_id, name, client_description, position)`
-- — no `client_visible` column and no `client_visible` value — while
-- 20260917020000's loop inserts `client_visible` as its fourth column.
--
-- Checked the rest of 20260927020000's body against every earlier
-- migration that had touched `create_project_from_template`
-- (20260915010000, 20260917020000) line by line: the task-insert loop,
-- checklist-insert loop, and grant/revoke footer are all otherwise
-- byte-for-byte unchanged. F015 (20260929010000_f015_flag_assumption_atomic.sql)
-- never touches `project_phases` or this function at all (grepped every
-- migration referencing `project_phases`), so there is nothing of F015's
-- to restore here — only F016h's one dropped column/value.
--
-- Signature is unchanged from 20260927020000 (still the 7-arg
-- p_deliverables version), so `create or replace` is used directly; no
-- drop is needed.
create or replace function public.create_project_from_template(
  p_workspace_id uuid,
  p_name text,
  p_description text,
  p_created_by uuid,
  p_tasks jsonb,
  p_phases jsonb default '[]'::jsonb,
  p_deliverables jsonb default '[]'::jsonb
)
returns table (
  project_id uuid,
  project_key text,
  project_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_project_key text;
  v_task jsonb;
  v_task_id uuid;
  v_checklist jsonb;
  v_position double precision := 0;
  v_phase jsonb;
  v_phase_position integer := 0;
  v_deliverable jsonb;
  v_deliverable_position integer := 0;
begin
  insert into projects (workspace_id, name, description, created_by)
  values (p_workspace_id, p_name, p_description, p_created_by)
  returning id, key into v_project_id, v_project_key;

  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    v_position := v_position + 1000;

    insert into tasks (
      project_id,
      title,
      description,
      description_json,
      status,
      priority,
      tags,
      estimate_minutes,
      author_id,
      position
    )
    values (
      v_project_id,
      v_task->>'title',
      v_task->>'description',
      v_task->'description_json',
      'todo',
      nullif(v_task->>'priority', ''),
      coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_task->'tags', '[]'::jsonb))),
        '{}'
      ),
      case
        when v_task->>'estimate_minutes' is null then null
        else (v_task->>'estimate_minutes')::integer
      end,
      p_created_by,
      v_position
    )
    returning id into v_task_id;

    for v_checklist in
      select * from jsonb_array_elements(coalesce(v_task->'checklistItems', '[]'::jsonb))
    loop
      insert into checklist_items (task_id, content, position)
      values (
        v_task_id,
        v_checklist->>'content',
        case
          when v_checklist->>'position' is null then 0
          else (v_checklist->>'position')::double precision
        end
      );
    end loop;
  end loop;

  for v_phase in select * from jsonb_array_elements(coalesce(p_phases, '[]'::jsonb))
  loop
    v_phase_position := v_phase_position + 1;

    insert into project_phases (
      project_id,
      name,
      client_description,
      client_visible,
      position
    )
    values (
      v_project_id,
      v_phase->>'name',
      v_phase->>'client_description',
      coalesce((v_phase->>'client_visible')::boolean, true),
      v_phase_position
    );
  end loop;

  for v_deliverable in select * from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb))
  loop
    v_deliverable_position := v_deliverable_position + 1;

    insert into client_deliverables (
      project_id,
      title,
      description,
      kind,
      owner_name,
      due_at,
      blocking,
      position
    )
    values (
      v_project_id,
      v_deliverable->>'title',
      v_deliverable->>'description',
      v_deliverable->>'kind',
      v_deliverable->>'owner_name',
      case
        when v_deliverable->>'due_offset_days' is null then null
        else current_date + (v_deliverable->>'due_offset_days')::integer
      end,
      coalesce((v_deliverable->>'blocking')::boolean, false),
      v_deliverable_position
    );
  end loop;

  return query select v_project_id, v_project_key, p_name;
end;
$$;

revoke all on function public.create_project_from_template(uuid, text, text, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_project_from_template(uuid, text, text, uuid, jsonb, jsonb, jsonb) to service_role;
