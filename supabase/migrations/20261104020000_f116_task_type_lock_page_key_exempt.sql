-- F116 follow-up, same worker/session: corrects
-- 20261104010000_f116_task_type_taxonomy.sql's task_types_lock_system_
-- flags() trigger function before any other environment applies that
-- migration. The first version locked system_key changes on EVERY
-- system-keyed row, including 'page' -- breaking F006c's own tested,
-- intentional admin affordance for reassigning which workspace type
-- plays the portal's page role (tests/integration/
-- f006c-task-type-system-key-write-path.test.ts). AS-059 itself only
-- requires the billable flag be fixed; system_key reassignment is now
-- only locked for the five NEW keys this feature introduces.
--
-- A new migration rather than editing 20261104010000 in place, per this
-- mission's own forward-only convention (docs/migration history has
-- lost work four times to migrations re-created/edited from memory) --
-- even though, as far as this session knows, no other environment has
-- applied 20261104010000 yet, a second file is the uniformly-safe
-- choice regardless.
create or replace function public.task_types_lock_system_flags()
returns trigger
language plpgsql
as $$
begin
  if OLD.system_key is not null then
    if NEW.is_billable is distinct from OLD.is_billable then
      raise exception 'task_types: is_billable is fixed on a system task type'
        using errcode = '42501';
    end if;
    if OLD.system_key <> 'page' and NEW.system_key is distinct from OLD.system_key then
      raise exception 'task_types: system_key is fixed on this system task type'
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$$;
