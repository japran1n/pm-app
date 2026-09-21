-- F001 (missions/20260921-clickup-website-template): three additive
-- extensions to project templates:
--
-- 1. Subtask hierarchy: a `kind='project'` template task payload element
--    may now carry an optional `children` array (same task shape,
--    recursively, bounded to depth 5 at the Zod layer --
--    lib/validation/templates.ts's `projectTemplateTaskSchema`). The RPC
--    walks that tree and creates each child with `parent_task_id` set to
--    its parent's freshly-created id, preserving array order via the
--    same `v_position += 1000` convention the existing flat loop already
--    uses (order is a single monotonic counter shared across the whole
--    walk, not per-level, so siblings-of-different-parents still sort
--    the same way a flattened board view already expects).
--
-- 2. Phase-per-task: a task payload element may carry an optional
--    `phase` string, matched by name against this same call's `p_phases`
--    array. A child task with no `phase` of its own inherits its
--    parent's resolved phase (per this feature's clarified answer) --
--    an unmatched phase name resolves to NULL rather than erroring, same
--    "templates are best-effort content, not strict validation" posture
--    `create_project_from_template` already has for every other field.
--
-- Both extensions are purely additive to the SAME `p_tasks` jsonb
-- parameter this function already accepts -- no signature change, so
-- `create or replace` is used directly (no drop needed, matching the
-- convention this function's own header comments already document for
-- signature-preserving edits, e.g. 20260917020000's phase-visibility
-- fix).
--
-- Also restores `client_visible` to the `project_phases` insert, which
-- 20260927020000_f013_project_template_deliverables.sql's full function
-- body replacement accidentally dropped (regression from
-- 20260917020000) -- every phase created from a template since that
-- migration has silently ignored a source phase's `client_visible = false`
-- and come back visible to the client. Restoring this is in scope here
-- because this migration already rewrites the phase-insert loop this bug
-- lives in.
--
-- The task-insert loop is factored into a new recursive helper,
-- `public._create_project_from_template_tasks`, since PL/pgSQL supports
-- recursive function calls but not recursive loops within a single
-- function body over an arbitrarily-nested jsonb tree.
create or replace function public._create_project_from_template_tasks(
  p_project_id uuid,
  p_tasks jsonb,
  p_parent_task_id uuid,
  p_default_phase_id uuid,
  p_phase_map jsonb,
  p_created_by uuid,
  p_position_start double precision
)
returns double precision
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task jsonb;
  v_task_id uuid;
  v_checklist jsonb;
  v_position double precision := p_position_start;
  v_phase_name text;
  v_phase_id uuid;
begin
  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    v_position := v_position + 1000;

    v_phase_name := v_task->>'phase';
    if v_phase_name is not null and p_phase_map ? v_phase_name then
      v_phase_id := (p_phase_map->>v_phase_name)::uuid;
    else
      -- No phase named on this task (or the name doesn't match any
      -- phase in this template): children inherit the parent's already-
      -- resolved phase, top-level tasks with no match get NULL.
      v_phase_id := p_default_phase_id;
    end if;

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
      position,
      parent_task_id,
      phase_id
    )
    values (
      p_project_id,
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
      v_position,
      p_parent_task_id,
      v_phase_id
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

    if jsonb_typeof(v_task->'children') = 'array' then
      v_position := public._create_project_from_template_tasks(
        p_project_id,
        v_task->'children',
        v_task_id,
        v_phase_id,
        p_phase_map,
        p_created_by,
        v_position
      );
    end if;
  end loop;

  return v_position;
end;
$$;

revoke all on function public._create_project_from_template_tasks(uuid, jsonb, uuid, uuid, jsonb, uuid, double precision) from public;
grant execute on function public._create_project_from_template_tasks(uuid, jsonb, uuid, uuid, jsonb, uuid, double precision) to service_role;

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
  v_phase jsonb;
  v_phase_id uuid;
  v_phase_position integer := 0;
  v_phase_map jsonb := '{}'::jsonb;
  v_deliverable jsonb;
  v_deliverable_position integer := 0;
begin
  insert into projects (workspace_id, name, description, created_by)
  values (p_workspace_id, p_name, p_description, p_created_by)
  returning id, key into v_project_id, v_project_key;

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
    )
    returning id into v_phase_id;

    -- Phase names are the join key task payloads use (`phase` field);
    -- a template's `phases[]` names are unique by construction
    -- (saveProjectAsTemplate snapshots a project's own phases, which are
    -- distinct rows) but even if two entries share a name, the later
    -- one simply wins the map slot -- no error, same best-effort
    -- posture the rest of this function already has.
    v_phase_map := v_phase_map || jsonb_build_object(v_phase->>'name', v_phase_id::text);
  end loop;

  perform public._create_project_from_template_tasks(
    v_project_id,
    p_tasks,
    null,
    null,
    v_phase_map,
    p_created_by,
    0
  );

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

-- F001: default project template per workspace. `is_default` is scoped
-- to `kind='project'` templates only (a workspace picks at most one
-- default it uses to preselect the "Start from template" option in
-- new-project-dialog.tsx) -- the partial unique index enforces "at most
-- one default per workspace per kind" at the DB layer so a race between
-- two concurrent `setDefaultTemplate` calls can never leave two rows
-- both `is_default = true`.
alter table public.task_templates
  add column if not exists is_default boolean not null default false;

comment on column public.task_templates.is_default is
  'F001: when true, this template is preselected in the "Start from template" picker for its workspace. At most one default per (workspace_id, kind) -- enforced by task_templates_one_default_per_workspace_kind_idx.';

create unique index if not exists task_templates_one_default_per_workspace_kind_idx
  on public.task_templates (workspace_id, kind)
  where is_default;
