-- F219: admin CRUD on board columns (AS-404, AS-405, AS-414, AS-415).
--
-- Two DB-level changes, both required because F218's `project_statuses`
-- table makes column NAMES caller-controlled for the first time:
--
-- 1. `tasks.status` (text) still carries `tasks_status_check`
--    (supabase/migrations/20260818013434_create_tasks.sql), a CHECK
--    limiting it to the original fixed four names. F218's
--    `sync_task_status_and_status_id` trigger derives `tasks.status` from
--    `status_id`'s `project_statuses.name` on every insert/update. The
--    moment an admin renames or adds a column with a non-default name and
--    a task is moved into it, that trigger writes a non-conforming value
--    and the old CHECK rejects the write outright — every task move into
--    a custom column would hard-fail. `tasks.status` must stay live and
--    populated (F223 is the feature that finishes migrating readers off
--    it; F270 is the dedicated cleanup feature that drops it), so the fix
--    here is additive: relax the CHECK rather than drop the column.
--    Replaced with a weaker non-empty guard so the column still can't be
--    written as blank/whitespace, matching this table's existing
--    "CHECK constraints for fixed-value columns" convention
--    (create_tasks.sql's own header comment) as closely as possible while
--    admitting the now-per-project set of names.
--
-- 2. AS-415 (a project can never be left with zero columns) is enforced
--    here as the last line of defense — a BEFORE DELETE trigger on
--    `project_statuses` that rejects a delete that would leave its
--    project with zero rows. The Server Action layer
--    (lib/actions/statuses.ts) is the FIRST line (checked before issuing
--    the delete at all, so the caller gets a friendly message instead of
--    a raw Postgres exception), per this repo's "the DB is the last line,
--    not the only line" convention.

-- ---------------------------------------------------------------------
-- 1. Relax tasks.status's CHECK constraint to admit custom column names.
-- ---------------------------------------------------------------------

alter table tasks drop constraint if exists tasks_status_check;

alter table tasks add constraint tasks_status_not_empty
  check (btrim(status) <> '');

-- ---------------------------------------------------------------------
-- 2. AS-415: a project can never be left with zero board columns.
-- ---------------------------------------------------------------------

create or replace function public.prevent_last_project_status_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
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

drop trigger if exists project_statuses_prevent_last_delete on project_statuses;
create trigger project_statuses_prevent_last_delete
  before delete on project_statuses
  for each row
  execute function public.prevent_last_project_status_delete();
