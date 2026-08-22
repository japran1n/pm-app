-- F175: recurrence rule storage (AS-314, AS-323)
--
-- Adds recurrence storage to `tasks`:
--   - recurrence jsonb: { freq, interval, until } where
--       freq     is one of 'daily' | 'weekly' | 'monthly' | 'every_n_days'
--       interval is a positive integer (the "N" in "every N days", or the
--                repeat multiplier for daily/weekly/monthly — e.g.
--                { freq: "weekly", interval: 2 } means every 2 weeks)
--       until    is an OPTIONAL ISO date string (jsonb string, e.g.
--                "2026-12-31") marking the last date an occurrence may be
--                generated on. Omitting the key (or storing JSON null)
--                means "no end date" — this is how AS-323's two cases
--                ("ends on date X" vs "never ends") are expressed
--                unambiguously in this shape: presence/absence (or
--                explicit null) of the `until` key, not a sentinel value.
--   - recurrence_parent_id uuid: self-referencing FK to tasks.id, nullable.
--     Links a generated occurrence back to the recurring task that spawned
--     it. ON DELETE SET NULL so deleting the parent doesn't cascade-delete
--     already-generated occurrences (they become standalone tasks).
--   - last_occurrence_at timestamptz: nullable, tracks when the most recent
--     occurrence was generated. Used later by F177/F178 for idempotent
--     generation (don't generate twice for the same period). Not touched by
--     this feature beyond adding the column.
--
-- Additive only, per this mission's migration-safety convention: new
-- nullable columns, no drops, no backfill needed (empty/day-one state is
-- "no task has a recurrence yet", which is valid).
--
-- CHECK constraint (tasks_recurrence_shape) validates the jsonb shape at
-- the DB level, per this feature's Clarified implementation ("in the
-- database AND mirrored in a Zod schema for the action layer"):
--   - a NULL recurrence always passes (guarded first via `recurrence is
--     null or (...)`)
--   - freq must be one of the four allowed values (AS-314)
--   - interval must be present and a positive integer
--   - until, when present and not JSON null, must be a valid ISO date
--     string (cast to date to prove it's a real, unambiguous date)
-- Full RFC 5545 RRULE support is out of scope (per Notes for
-- clarification); these four rule shapes are the entire contract.
--
-- Index: tasks_recurrence_active_idx is a partial index on
-- (recurrence is not null and deleted_at is null), matching exactly the
-- predicate the future scheduled job (F177/F178) will filter on to find
-- active recurring tasks needing new occurrences.
--
-- No RLS changes: tasks already has RLS policies (workspace-membership
-- scoped) from earlier migrations; these are just new columns on that same
-- row, read/written through the existing policies — same pattern as
-- 20260822030000_tasks_estimate_minutes.sql (F166).

alter table tasks
  add column if not exists recurrence jsonb,
  add column if not exists recurrence_parent_id uuid references tasks(id) on delete set null,
  add column if not exists last_occurrence_at timestamptz;

alter table tasks
  add constraint tasks_recurrence_shape
  check (
    recurrence is null
    or (
      (recurrence ? 'freq')
      and (recurrence->>'freq') in ('daily', 'weekly', 'monthly', 'every_n_days')
      and (recurrence ? 'interval')
      and (recurrence->>'interval') ~ '^[0-9]+$'
      and (recurrence->>'interval')::int > 0
      and (
        not (recurrence ? 'until')
        or recurrence->'until' = 'null'::jsonb
        or (
          jsonb_typeof(recurrence->'until') = 'string'
          and (recurrence->>'until')::date is not null
        )
      )
    )
  );

create index if not exists tasks_recurrence_active_idx
  on tasks (id)
  where recurrence is not null and deleted_at is null;
