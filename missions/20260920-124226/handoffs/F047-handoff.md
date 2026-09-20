# Handoff: F047 — Purge task_id from app code

## Status
COMPLETE

## Assertions covered
AS-025: PASS — grep for task_id/taskId across lib/queries/calendar-blocks.ts, lib/actions/calendar-blocks.ts, lib/validation/calendar-blocks.ts, tests/integration/calendar-blocks-crud.test.ts returns zero matches; `npx tsc --noEmit` is clean.
AS-038: PASS — same grep/tsc verification; calendar-block insert/update/select payloads no longer send or expect a task_id column, matching the dropped DB column from F009's migration.

## Files changed
lib/queries/calendar-blocks.ts
lib/actions/calendar-blocks.ts
lib/validation/calendar-blocks.ts
tests/integration/calendar-blocks-crud.test.ts
tests/unit/calendar-week-time-grid-live-resize.test.tsx

## Commands run
`grep -rn "task_id\|taskId" lib/queries/calendar-blocks.ts lib/actions/calendar-blocks.ts lib/validation/calendar-blocks.ts tests/integration/calendar-blocks-crud.test.ts` (0 matches, exit 1/no output)
`npx tsc --noEmit` (0)
`npx eslint lib/queries/calendar-blocks.ts lib/actions/calendar-blocks.ts lib/validation/calendar-blocks.ts --max-warnings=0` (0)
`npx vitest run tests/unit` (133 failed / 3257 passed — pre-existing failures unrelated to this change, verified via `git stash` baseline run of one failing file, tests/unit/list-due-date-cell-optimistic.test.tsx, which fails identically on main before my changes)
`npx vitest run tests/unit -t "calendar"` (0 — 29/29 calendar-related unit tests pass)
`npx vitest run tests/integration/calendar-blocks-crud.test.ts` (skipped — no network/DB access in this sandbox; suite uses `describe.skipIf(!haveAdminCreds)`/live Supabase fetch and errors with `fetch failed` in `beforeAll` rather than running any assertions; this is an environment limitation, not a code issue)
`git commit` (0)

## Decisions made
- Removed `taskId`/`task_id` from `CalendarBlock`/`CalendarBlockRow` types, the query select string, `SELECT_COLUMNS`, insert payload, update patch, and all three Zod schemas (create/update) exactly per the file/line list in the spec.
- Also fixed `tests/unit/calendar-week-time-grid-live-resize.test.tsx`, which constructs a `CalendarBlock` literal including `taskId: null` — this is direct type-fallout from the `CalendarBlock` type change (not in the spec's file list) and was required to keep `npx tsc --noEmit` clean project-wide. Kept the fix minimal (deleted the one field).
- Left a stray explanatory comment in `lib/actions/calendar-blocks.ts` header that referenced `taskId` as "always optional" — rewrote it to just describe blocks as not being a task entity, since the field no longer exists.
- Did not touch `components/calendar/week-agenda.tsx`, `week-time-grid.tsx`, `day-cell.tsx`, `calendar-day-grid.tsx` even though they contain unrelated `taskId` identifiers — those refer to task due-date rendering (a separate concept from calendar_blocks), not the dropped column, and are outside this feature's file scope.
- `tests/integration/planner-block-rls.test.ts` showed as modified in git status at start of session (comment text referencing renamed migration file names) — this was pre-existing uncommitted work from an earlier F011 session, not something I touched; left untouched and did not include it in my commit.

## Out-of-scope work needed
None identified beyond what's noted above (components/calendar/*.tsx taskId usages are for task due dates, not calendar_blocks.task_id, and are correctly out of scope for this feature).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Fixed the type error in tests/unit/calendar-week-time-grid-live-resize.test.tsx (not in the spec's file list) because it was a direct, mechanical consequence of removing `taskId` from the `CalendarBlock` type and blocked a clean `npx tsc --noEmit`, which the spec explicitly requires to pass.

## Notes for the next worker
The integration test tests/integration/calendar-blocks-crud.test.ts could not be executed against a live database in this sandbox (no network egress). Its structure and assertions were unchanged except for removing the task_id column from its select/expect calls, mirroring the pattern used elsewhere in that same file for other dropped/renamed columns. If CI has live DB access, re-run `npx vitest run tests/integration/calendar-blocks-crud.test.ts` there to confirm the 10 tests pass end-to-end.
