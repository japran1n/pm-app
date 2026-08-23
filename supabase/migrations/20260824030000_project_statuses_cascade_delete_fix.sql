-- F219 follow-up fix (orchestrator-reported blocker): the AS-415
-- "never zero columns" guard added by
-- supabase/migrations/20260824020000_project_statuses_management.sql
-- (`project_statuses_prevent_last_delete`) also fired during the
-- `ON DELETE CASCADE` from `projects` — deleting a project deletes its
-- `project_statuses` rows one at a time via the cascade, and on the LAST
-- one `v_remaining = 0`, so the trigger raised and blocked the delete.
-- Reproduced directly against the linked DB with the service-role client:
-- seeding the default four columns, then hard-deleting the project,
-- raised `{"code":"P0001","message":"A project must have at least one
-- board column."}` — project hard-delete was impossible.
--
-- Fix: a cascade delete has already removed the PARENT `projects` row by
-- the time Postgres fires the child `project_statuses` deletes (that is
-- how `ON DELETE CASCADE` is implemented), so checking "does the parent
-- project still exist" distinguishes a genuine standalone column delete
-- (parent still exists -> guard applies) from a cascade-from-parent
-- delete (parent already gone -> let it proceed) without needing any
-- session variable, application-layer flag, or trigger-disable dance.
--
-- Additive: `create or replace function` on the existing trigger
-- function, same trigger definition, no new table/column. The already
-- applied 20260824020000 migration file is left untouched.

create or replace function public.prevent_last_project_status_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  -- The project itself is being deleted (this delete arrived via
  -- `ON DELETE CASCADE` from `projects`) — the parent row is already gone
  -- by the time this trigger fires, so there is no "leaving the project
  -- with zero columns" to guard against; the project itself won't exist
  -- to have any columns. Let the cascade proceed.
  if not exists (select 1 from projects where id = old.project_id) then
    return old;
  end if;

  select count(*) into v_remaining
  from project_statuses
  where project_id = old.project_id
    and id <> old.id;

  if v_remaining = 0 then
    raise exception 'A project must have at least one board column.'
      using errcode = 'P0001';
  end if;

  return old;
end;
$$;
