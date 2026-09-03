-- F013 (missions/20260903-portal, M3): extends the `kind='project'`
-- template payload with a `deliverables[]` section, so the standard
-- "what we need from the client" content list arrives with the project
-- instead of being typed per client (this feature's own spec, section
-- 4). Mirrors 20260915010000's own `p_phases` addition to
-- `create_project_from_template` exactly: one more jsonb array
-- parameter, defaulted to `'[]'::jsonb` so a template saved BEFORE this
-- migration — whose stored payload jsonb has no `deliverables` key at
-- all — still creates a project with zero deliverables seeded, not an
-- error. Backward compatibility is enforced at the Zod layer too (see
-- lib/validation/templates.ts's `projectTemplatePayloadSchema.deliverables`,
-- same `.default([])` pattern as its `phases` sibling).
--
-- Postgres cannot change an existing function's parameter list via
-- `create or replace` (a different arg list is a distinct overload), so
-- the old 6-arg signature (p_workspace_id, p_name, p_description,
-- p_created_by, p_tasks, p_phases) is dropped outright rather than left
-- behind as a dead, differently-shaped overload nothing calls — same
-- convention 20260915010000's own header comment already established.
drop function if exists public.create_project_from_template(uuid, text, text, uuid, jsonb, jsonb);

-- p_deliverables is a jsonb array, each element shaped like
-- `projectTemplateDeliverableSchema` (lib/validation/templates.ts):
-- `{ title, description, kind, owner_name, blocking, due_offset_days }`.
-- No `due_at` (an absolute date makes no sense inside a reusable
-- template): `due_offset_days` is nullable — when set, the seeded
-- deliverable's `due_at` is `current_date + due_offset_days`, so a
-- template can still say "we need the client's logo files within the
-- first 3 days" without baking in a calendar date that would already be
-- wrong the second time the template is used. `state`/`delivered_at`/
-- `accepted_at`/`accepted_by`/`review_note` are left at their column
-- defaults for every newly-seeded deliverable, same "a template captures
-- IDENTITY and CLIENT-FACING CONTENT, never a snapshot of an in-flight
-- project's current progress" rule 20260915010000 already applied to
-- phases (state/dates left at column defaults there too).
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
      position
    )
    values (
      v_project_id,
      v_phase->>'name',
      v_phase->>'client_description',
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
