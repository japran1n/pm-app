-- Mission 20260919-150607, F073 (AS-080/081/083): make bulk discipline
-- estimate writes atomic.
--
-- `setDisciplineEstimatesBulk` previously ran a `.delete()` for cleared
-- disciplines and a separate `.upsert()` for set disciplines -- two
-- round-trips, not atomic: a failure after the delete but before the
-- upsert permanently lost data. The fix folds both cases into a single
-- multi-row `.upsert()` call, representing a "cleared" discipline as a row
-- with minutes = null instead of no row at all.
--
-- This requires `minutes` to accept null. The `minutes > 0` check is
-- relaxed to also allow null (a cleared row), while still rejecting 0 or
-- negative values whenever minutes IS set.
alter table task_discipline_estimates
  alter column minutes drop not null;

alter table task_discipline_estimates
  drop constraint if exists task_discipline_estimates_minutes_check;

alter table task_discipline_estimates
  add constraint task_discipline_estimates_minutes_check
  check (minutes is null or minutes > 0);
