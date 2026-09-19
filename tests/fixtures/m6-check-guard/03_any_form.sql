alter table public.tasks drop constraint if exists tasks_test_kind_check;
alter table public.tasks add constraint tasks_test_kind_check check (
  kind = any (array['alpha', 'beta', 'gamma', 'delta'])
);
