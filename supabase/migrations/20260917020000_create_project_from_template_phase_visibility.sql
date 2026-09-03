-- F006h (missions/20260903-portal, M1-scrutiny-2.md NM-2 / FU-18 —
-- AS-009, AS-012): `create_project_from_template` drops `client_visible`
-- on the template round trip. `saveProjectAsTemplate`
-- (lib/actions/templates.ts) previously selected only
-- `name, client_description` when snapshotting a project's phases, and
-- this function (20260915010000) left every newly-seeded phase's
-- `client_visible` at the `project_phases` column default of `true`. A
-- phase deliberately hidden from the client in the source project
-- (`client_visible = false`) came back VISIBLE in every project created
-- from that template — and `project_phases.client_visible` is exactly
-- the column the portal timeline and every portal progress figure filter
-- on (AS-012). Visibility is a privacy decision the team made about that
-- phase, not a snapshot of an in-flight project's current progress —
-- the same category `state` and the four date columns are correctly
-- excluded from, per this function's own comment at 20260915010000:29-32,
-- but `client_visible` does not belong in that excluded set.
--
-- No signature change (still `p_phases jsonb default '[]'::jsonb`, same
-- 6-arg list as 20260915010000), so `create or replace` is used directly
-- — Postgres only requires a drop when the parameter list itself changes,
-- and this only changes what one element of the p_phases jsonb array is
-- read for and what column it feeds. `coalesce((v_phase->>'client_visible')::boolean, true)`
-- keeps a template payload saved BEFORE this fix (whose stored `phases`
-- elements have no `client_visible` key at all) resolving to the exact
-- `true` default it already produced — i.e. this is purely additive for
-- existing data, matching this function's own established "templates
-- without a phases section keep working" convention
-- (20260915010000:6-8) one level down, applied per-field instead of
-- per-array.
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

  return query select v_project_id, v_project_key, p_name;
end;
$$;

revoke all on function public.create_project_from_template(uuid, text, text, uuid, jsonb, jsonb) from public;
grant execute on function public.create_project_from_template(uuid, text, text, uuid, jsonb, jsonb) to service_role;
