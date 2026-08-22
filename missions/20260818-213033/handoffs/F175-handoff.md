# Handoff: F175 — recurrence rule storage

## Status
COMPLETE

## Assertions covered
AS-314: PASS — `tests/integration/tasks-recurrence-shape.test.ts` proves all four freq values (daily, weekly, monthly, every_n_days) with a positive interval are accepted, and that an unsupported freq, a zero interval, and a missing interval are all rejected by the `tasks_recurrence_shape` CHECK constraint.
AS-323: PASS — same test file proves `until` round-trips faithfully when present (an explicit end date) and that omitting the `until` key round-trips as "no end date" (the key stays absent), so the schema unambiguously supports both cases. An invalid `until` date string is rejected on insert (Postgres's own `::date` cast error, verified). Generation logic that actually stops producing occurrences after `until` is explicitly out of scope for this feature — belongs to F177/F178 per the spec.

## Files changed
supabase/migrations/20260822140000_tasks_recurrence.sql
lib/supabase/database.types.ts
tests/integration/tasks-recurrence-shape.test.ts
missions/20260818-213033/handoffs/F175-handoff.md

## Commands run
`supabase migration list --linked` (0) — sanity check, project was in sync before starting
`supabase db push` (0) — applied 20260822140000_tasks_recurrence.sql to the linked remote project
`supabase gen types typescript --linked > lib/supabase/database.types.ts` (0)
`npx vitest run tests/integration/tasks-recurrence-shape.test.ts` (0) — 12/12 passed, standalone
`npm run test` (0 for vitest's own exit but 11 unrelated pre-existing tests timed out under full-suite load — see Notes)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors — 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts, not touched by this feature)

## Decisions made
- **`recurrence` jsonb shape**: `{ freq: 'daily' | 'weekly' | 'monthly' | 'every_n_days', interval: <positive int>, until?: <ISO date string> }`. `interval` doubles as the repeat multiplier for daily/weekly/monthly (e.g. `{ freq: 'weekly', interval: 2 }` = every 2 weeks) and as the literal "N" for `every_n_days`. This exact shape is now the contract F176-F179 must read/write against.
- **`until` unambiguity (AS-323)**: absence of the `until` key (or storing JSON `null`) = no end date; presence of a valid ISO date string = ends on that date. Chosen over a sentinel value (e.g. `until: null` meaning something different from a missing key) because it needed no second source of truth and no extra dependency — the simpler option per this feature's Round-B ambiguity-resolution answer. The CHECK constraint treats "key absent" and "key present with JSON null" as equally valid (both skip the date-cast check); only a present, non-null `until` is validated as a real date.
- **CHECK constraint (`tasks_recurrence_shape`)** is guarded `recurrence is null or (...)` first, so a NULL recurrence (the day-one empty state) always passes with zero constraint evaluation cost. Interval validation uses a regex (`^[0-9]+$`) before the int cast so a non-numeric interval fails cleanly rather than raising a cast error, matching the "constraint rejects it, mapped to a field-level message" failure-handling answer. An invalid `until` string still raises a raw Postgres `invalid input syntax for type date` error rather than a clean constraint-name violation, because Postgres evaluates the `::date` cast before the CHECK's boolean result — this is a known, understood tradeoff (documented in the migration's own comment and the test's comment) since even a raw error still rejects the insert, which is what safety requires here.
- **`recurrence_parent_id`** is `ON DELETE SET NULL`, not CASCADE — deleting a recurring parent task should not delete already-generated occurrence tasks, since those are now standalone, real tasks in their own right.
- **No RLS changes.** `recurrence`, `recurrence_parent_id`, and `last_occurrence_at` are new columns on the existing `tasks` table, which already has workspace-membership-scoped RLS from earlier migrations (same pattern as F166's `estimate_minutes`, confirmed by reading `supabase/migrations/20260822030000_tasks_estimate_minutes.sql`). No new resource type is introduced, so no new predicate is needed.
- **Index**: `tasks_recurrence_active_idx`, a partial index `on tasks (id) where recurrence is not null and deleted_at is null` — matches exactly the predicate the future scheduled job (F177/F178) will filter on.
- **Full RFC 5545 RRULE is explicitly out of scope** (per the spec's own Notes for clarification) — the four freq shapes above are the entire contract.

## Out-of-scope work needed
- **Generation logic** (turning a `recurrence` row into new occurrence tasks, respecting `until` and `last_occurrence_at` for idempotency) is F177/F178's job, not this feature's. This feature only proves the storage shape is sound.
- **Zod schema mirroring the CHECK constraint** for the action layer (per Clarified implementation's validation-rules answer: "in the database AND mirrored in a Zod schema") belongs to whichever feature adds the Server Action that lets a user set/edit a task's recurrence (not yet built as of F175) — no `lib/actions/` file for recurrence exists yet to add the Zod schema to.
- **UI for setting recurrence on a task** is out of scope for this DB-only feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `every_n_days` (snake_case, matching this migration's other jsonb key names) as the literal freq string for the "custom interval of N days" case, since the spec didn't pin an exact string. Recorded here so F176-F179 use the same literal.

## Notes for the next worker
- Verified via Supabase CLI (not MCP tool calls — `supabase migration list --linked` and `supabase db push` were used directly per this feature's pre-flight instructions; `SUPABASE_ACCESS_TOKEN` was already configured and working) that the migration applied cleanly to the linked remote project with no destructive changes.
- `npm run test`'s full-suite run showed 11 unrelated test failures, all `Hook timed out` / `Test timed out` errors in integration tests across many features (invite-member, workspace-role-expansion, rls-tasks, transfer-ownership, etc.) — none touch `recurrence`, `recurrence_parent_id`, or `last_occurrence_at`, and running `tests/integration/tasks-recurrence-shape.test.ts` standalone passes 12/12 every time. This matches the flaky-under-full-suite-load pattern already documented in prior handoffs (e.g. F299's handoff: "same known flaky-test-under-load pattern this mission has already hit twice before"), caused by many parallel integration tests hitting the same live Supabase project's connection/rate limits simultaneously, not a regression from this migration.
- The migration file itself carries a long doc comment explaining the shape, the `until` ambiguity design, the CHECK constraint's guard ordering, and the index's purpose — read it directly for the exact SQL rather than re-deriving it.
