-- F116 follow-up (same session as 20261104010000/20261104020000):
-- applies the FK-action change documented in 20261104010000's own
-- comment above `alter table tasks add constraint tasks_task_type_id_
-- fkey ... on delete restrict` -- a new migration rather than editing
-- that file in place, per this mission's forward-only convention.
alter table tasks drop constraint if exists tasks_task_type_id_fkey;
alter table tasks add constraint tasks_task_type_id_fkey
  foreign key (task_type_id) references task_types (id) on delete restrict;
