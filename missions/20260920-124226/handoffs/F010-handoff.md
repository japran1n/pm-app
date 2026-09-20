# Handoff: F010 — apply migrations regen types

## Status
COMPLETE

## Assertions covered
AS-076: PASS — `npm run migrations:check` exits 0 with "No migration drift — all migrations present on remote."

## Files changed
lib/supabase/database.types.ts
lib/seed/full-demo-project.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260920113500_calendar_blocks_workspace_wide_select.sql` (0)
`npm run db:apply -- supabase/migrations/20260920113501_calendar_blocks_drop_task_id.sql` (0)
`npm run db:gen-types` (0)
`npm run migrations:check` (0)
`npx tsc --noEmit` (0)
`npx vitest run tests/unit` (0 — 41 failed files / 133 failed tests, all pre-existing and unrelated to this feature; confirmed identical failure count via `git stash` before my changes)
`npx eslint lib/seed/full-demo-project.ts lib/supabase/database.types.ts --max-warnings=0` (0)

## Decisions made
- Applied both migration files individually via `db:apply` (the script requires an explicit file argument, not batch mode).
- After regenerating types, `task_id` on `calendar_blocks` was removed from the generated insert type, which broke `lib/seed/full-demo-project.ts` at a hardcoded insert literal that still set `task_id: wireframesId`. Removed that field from the insert object — this is a direct consequence of the schema migration (task_id column dropped) and the seed data still inserts the same calendar block, just without the now-nonexistent task association. `wireframesId` remains used at many other call sites in the same file so no unused-variable issue was introduced.
- Did not touch the 41 pre-existing failing test files — verified via `git stash`/`git stash pop` that the exact same set of failures (133 tests) exists on `main` before this feature's changes, so they are out of scope for F010.

## Out-of-scope work needed
The 41 pre-existing failing vitest files (133 tests, e.g. `tests/unit/list-due-date-cell-optimistic.test.tsx`) are unrelated to calendar_blocks/migrations and were already failing before this feature's changes. They should be triaged as a separate feature/bug fix; not something F010's scope (migration apply + type regen) covers.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Removed `task_id: wireframesId` from the second calendar_blocks seed insert in `lib/seed/full-demo-project.ts` rather than trying to preserve the task association some other way, since the column was dropped by design in migration `20260920113501_calendar_blocks_drop_task_id.sql` (F009) and the clarified spec for that migration establishes task_id is intentionally removed from calendar_blocks.

## Notes for the next worker
- `npm run db:apply` requires the migration file path as an argument (`npm run db:apply -- <path>`); it does not auto-discover pending migrations.
- Both migrations were newly applied this run (no idempotency conflicts encountered).
- No Supabase MCP calls were used — `db:apply`/`db:gen-types`/`migrations:check` are the project's own scripted tooling against the remote Supabase project via `.env` credentials, which fully satisfied AS-076 without needing schema introspection via MCP.
