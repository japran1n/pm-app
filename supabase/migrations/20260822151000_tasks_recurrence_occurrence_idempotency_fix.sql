-- F177 follow-up fix within the same feature: PostgREST's `.upsert(...,
-- { onConflict })` issues a plain `ON CONFLICT (recurrence_parent_id,
-- due_date)` with no WHERE clause, which Postgres can only resolve against
-- a NON-partial unique index/constraint (a partial index's predicate must
-- be repeated in the ON CONFLICT clause itself to be usable as an arbiter,
-- which PostgREST's upsert helper doesn't support) — verified against the
-- real linked project (`42P10: no unique or exclusion constraint matching
-- ON CONFLICT`) with the original migration's partial index.
--
-- Fix: drop the partial index from 20260822150000 and replace it with a
-- full (non-partial) UNIQUE constraint on the same two columns. This is
-- still exactly the guarantee AS-320 needs: NULL <> NULL under a standard
-- unique constraint, so every non-recurring task (recurrence_parent_id is
-- NULL) is entirely unaffected — the constraint only ever fires for two
-- rows that share the same non-null recurrence_parent_id AND the same
-- due_date, which is precisely "two occurrences of the same series on the
-- same date". The `deleted_at is null` scoping from the original partial
-- index is dropped as an acceptable, documented trade-off (a soft-deleted
-- occurrence still occupies its due-date slot in the series going
-- forward) rather than reintroducing a predicate PostgREST's upsert can't
-- target.

drop index if exists tasks_recurrence_occurrence_idempotency;

alter table tasks
  add constraint tasks_recurrence_occurrence_idempotency
  unique (recurrence_parent_id, due_date);
