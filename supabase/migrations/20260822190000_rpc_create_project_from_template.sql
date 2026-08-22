-- F184: create_project_from_template RPC (AS-333)
--
-- Creates a project AND every one of a `kind='project'` template's tasks
-- (F181's `task_templates` table) as ONE atomic unit: the project insert
-- (which fires F145's `assign_project_key` BEFORE INSERT trigger), and
-- each task insert (which fires F145's `assign_task_number` BEFORE INSERT
-- trigger, so every seeded task gets its own project-sequential key via
-- the SAME atomic per-project counter every other task-creation path in
-- this codebase relies on — no manually-computed number here), plus each
-- task's checklist items, all happen inside the body of a single
-- PL/pgSQL function. A single function invocation executes inside one
-- implicit transaction (the exact same atomicity idiom this migration's
-- sibling `create_workspace_with_owner`, supabase/migrations/
-- 20260817234323_workspace_create_rpc.sql, already established for
-- "workspace + owner-membership row must both exist or neither does") —
-- if ANY statement in the loop raises (e.g. a task title that fails
-- `tasks_title_not_empty`), Postgres rolls back the entire function
-- invocation, including the project insert that ran first. That is what
-- makes "a partial failure leaves nothing behind" hold: there is no
-- window where the project row is committed but zero/some of its
-- template tasks are.
--
-- SECURITY DEFINER, called via the admin client from
-- lib/actions/templates.ts's createProjectFromTemplate, mirroring
-- lib/actions/templates.ts's existing createTaskFromTemplate convention
-- (that action re-verifies membership + canWrite server-side itself,
-- using the admin client throughout, since the admin client bypasses RLS
-- entirely — the app-level check is the ONLY enforcement that action
-- performs). This function does not re-check membership/role itself; it
-- trusts its caller (the Server Action) the same way every other
-- admin-client-invoked write path in this codebase does. It is not
-- granted to `authenticated` at all (only `service_role`), so it cannot
-- be invoked directly by a client bypassing the Server Action's checks.
--
-- p_tasks is a jsonb array, each element shaped like F182's
-- `taskTemplatePayloadSchema` (validated by the SAME schema in
-- lib/validation/templates.ts before this function is ever called) minus
-- `assigneeIds` (project templates do not carry assignees — the spec's
-- explicit field list is title/description/priority/checklist/estimate,
-- plus description_json/tags for parity with the task-template payload
-- shape). Order is preserved: tasks are inserted in array order, so
-- their `number`s (and default board `position`s) come out in the same
-- order the template listed them.
create or replace function public.create_project_from_template(
  p_workspace_id uuid,
  p_name text,
  p_description text,
  p_created_by uuid,
  p_tasks jsonb
)
returns table (
  project_id uuid,
  project_key text,
  project_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_project_key text;
  v_task jsonb;
  v_task_id uuid;
  v_checklist jsonb;
  v_position double precision := 0;
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

  return query select v_project_id, v_project_key, p_name;
end;
$$;

revoke all on function public.create_project_from_template(uuid, text, text, uuid, jsonb) from public;
grant execute on function public.create_project_from_template(uuid, text, text, uuid, jsonb) to service_role;
