-- F006c (missions/20260903-portal, AS-009): a project created from a
-- `kind='project'` template arrives with no phases at all today —
-- `create_project_from_template` (20260822190000) has no phase handling,
-- and AS-009 was never assigned to any M1 feature (M1-scrutiny.md,
-- FU-12). A template's own phases (if it has any — see
-- lib/validation/templates.ts's `projectTemplatePayloadSchema.phases`,
-- optional/defaulted so a template saved before this feature, with no
-- `phases` key at all, still parses and still works) are now seeded
-- inside the SAME function invocation that creates the project and its
-- tasks — one implicit transaction, same atomicity guarantee this
-- function's own doc comment already describes for tasks: a failure
-- anywhere rolls back the whole call, so there is never a project with
-- some-but-not-all of its template's phases, or phases without a
-- project.
--
-- Postgres cannot change an existing function's parameter list via
-- `create or replace` (a different arg list is a distinct overload), so
-- the old 5-arg signature is dropped outright rather than left behind as
-- a dead, differently-shaped overload nothing calls.
drop function if exists public.create_project_from_template(uuid, text, text, uuid, jsonb);

-- p_phases is a jsonb array, each element shaped like
-- `projectTemplatePhaseSchema` (lib/validation/templates.ts):
-- `{ name, client_description }`. Order is preserved exactly like
-- p_tasks — phases are inserted in array order with a 1-based sequential
-- `position`, the same numbering `seed_default_phases` uses for its ten
-- Good Guys phases, not a caller-supplied position (nothing about a
-- freshly-saved template's phase order needs to survive a numeric gap).
-- `state` and `client_visible` are left at their column defaults
-- (`not_started` / `true`) — a template captures a phase's NAME and
-- CLIENT-FACING DESCRIPTION, never a snapshot of an in-flight project's
-- current progress.
create or replace function public.create_project_from_template(
  p_workspace_id uuid,
  p_name text,
  p_description text,
  p_created_by uuid,
  p_tasks jsonb,
  p_phases jsonb default '[]'::jsonb
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

  return query select v_project_id, v_project_key, p_name;
end;
$$;

revoke all on function public.create_project_from_template(uuid, text, text, uuid, jsonb, jsonb) from public;
grant execute on function public.create_project_from_template(uuid, text, text, uuid, jsonb, jsonb) to service_role;
