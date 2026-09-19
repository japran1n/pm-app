alter table public.tasks add constraint tasks_test_kind_check check (
  kind in ('alpha', 'beta')
);
