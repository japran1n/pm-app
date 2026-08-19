-- F145 follow-up (same feature, same worker session): give `projects.key`
-- and `tasks.number` trivial sentinel DEFAULTs so `supabase gen types`
-- marks them optional in the generated Insert type (Postgres codegen infers
-- Insert-optionality from a registered column DEFAULT, not from
-- NOT NULL + a BEFORE INSERT trigger). Without this, every existing
-- `.insert()` call in lib/actions/projects.ts / lib/actions/tasks.ts (and
-- tests/unit/fts-tasks.test.ts) — none of which this feature's Clarified
-- implementation "Touches" scope (supabase/migrations/ +
-- lib/supabase/database.types.ts only) allows editing — would fail
-- `npx tsc --noEmit` by suddenly being required to pass `key`/`number`
-- explicitly, even though both are always generated server-side by the
-- triggers added in 20260819061129_project_keys_and_task_numbers.sql.
--
-- '' and 0 are inert sentinels, never valid final values (the
-- projects_key_format CHECK rejects '', tasks_number_positive rejects 0),
-- so if a row somehow reached storage still holding one, a constraint
-- would catch it as a last resort — but in practice it never does,
-- because the trigger functions below are updated to treat "still the
-- sentinel" the same as "still NULL" and always overwrite it before the
-- row is stored, exactly like the original NULL-check did.
--
-- No re-backfill needed here: 20260819061129 already backfilled every
-- pre-existing row to a real, non-sentinel key/number before this
-- migration runs, so no existing row currently holds '' or 0 — this
-- migration only changes what happens for rows inserted from now on.

alter table projects
  alter column key set default '';

alter table tasks
  alter column number set default 0;

create or replace function public.assign_project_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key is null or new.key = '' then
    new.key := public.generate_unique_project_key(new.workspace_id, new.name);
  end if;
  return new;
end;
$$;

create or replace function public.assign_task_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  if new.number is null or new.number = 0 then
    update projects
    set task_counter = task_counter + 1
    where id = new.project_id
    returning task_counter into v_number;

    if v_number is null then
      raise exception 'project % not found for task number assignment', new.project_id;
    end if;

    new.number := v_number;
  end if;
  return new;
end;
$$;
