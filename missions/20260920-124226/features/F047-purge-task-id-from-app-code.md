# F047: purge task_id references from app code (M2 blocker)

**Milestone:** M2 follow-up (M2-scrutiny-1 FU-A)
**Estimated worker time:** 30 minutes
**Depends on:** F009 (migration dropped the column)

## Assertion IDs covered
- AS-025: active workspace member can read another member's blocks (Planner loads without throwing)
- AS-038: calendar_blocks has no task_id column (app code must agree)

## Problem
The task_id column was dropped from the DB by F009, but app code still references it:
- `lib/queries/calendar-blocks.ts:80` — select string includes `task_id`
- `lib/actions/calendar-blocks.ts:67` — SELECT_COLUMNS includes `task_id`
- `lib/actions/calendar-blocks.ts:195` — insert payload has task_id
- `lib/actions/calendar-blocks.ts:272,279` — update patch has task_id
- `lib/queries/calendar-blocks.ts:28,41,55` — row/domain types have taskId
- `lib/actions/calendar-blocks.ts:45,57` — types have task_id
- `lib/validation/calendar-blocks.ts:19,48,57` — Zod schemas have task_id
- `tests/integration/calendar-blocks-crud.test.ts:225-230` — test selects task_id

## Fix
Remove ALL references to task_id/taskId from those files. The column does not exist on the DB.
Run `npx tsc --noEmit` — must be clean (no task_id references on any type).
Run `npx eslint . --max-warnings=0` — clean.

IMPORTANT: After removing task_id from the select string in lib/queries/calendar-blocks.ts, test
that the getCalendarBlocks function compiles correctly and returns the right type.
