# Handoff: F060 — Fix AS-034 allowlist guard

## Status
COMPLETE

## Assertions covered
AS-034: PASS — Rewrote the calendar-subtree no-task-query test as an import allowlist. Verified it fails when `import { getMyTasks } from "@/lib/queries/my-tasks"` is added to `calendar/page.tsx`, then restored the file and confirmed the suite passes again (7/7 tests).

## Files changed
tests/unit/f016-calendar-page-no-task-query.test.ts

## Commands run
`npx vitest run tests/unit/f016-calendar-page-no-task-query.test.ts` (0) — 7 passed
`npx vitest run tests/unit/f016-calendar-page-no-task-query.test.ts` after mutation (1) — 2 failed as expected, confirming the guard catches the regression
`npx vitest run tests/unit/f016-calendar-page-no-task-query.test.ts` after restore (0) — 7 passed
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f016-calendar-page-no-task-query.test.ts --max-warnings=0` (0)

## Decisions made
- Read the actual `@/lib/queries/*` imports from the four files in scope (`calendar/page.tsx`, `week-view.tsx`, `week-time-grid.tsx`, `week-agenda.tsx`) rather than guessing: found `profile`, `calendar-blocks`, `time-off`, `members`. Built `ALLOWED_QUERY_MODULES` from exactly these four.
- Used a regex (`from\s+["'](@\/lib\/queries\/[^"']+)["']`) to extract every import path (static, type-only, or re-export) rather than matching specific import syntax variants, so the test catches new imports regardless of how they're spelled.
- Kept the original `getCalendarTasks` string-literal check and the `searchParams` shape check from the prior blocklist version since they cover distinct regression vectors (a same-name helper reused from an allowlisted module, and route-param task filtering) not covered by the import-path allowlist alone.
- Added a dedicated "never imports task query modules" test that explicitly lists the forbidden modules (`tasks`, `my-tasks`, `calendar`) for a clearer failure message, in addition to the allowlist-based test which would already catch any of these.
- Verified the mutation-and-restore cycle manually with `sed`, restoring the original file content exactly (diff after restore showed no changes to `calendar/page.tsx`).

## Out-of-scope work needed
None identified — this feature was scoped narrowly to rewriting one test file.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Retained the legacy `getCalendarTasks` substring check and the `searchParams` task-field check alongside the new allowlist mechanism, since the spec's "what to do" section focused on the import-allowlist rewrite but didn't say to remove the other regression guards, and removing them would reduce coverage without any stated reason to do so.

## Notes for the next worker
The test file lives at `tests/unit/f016-calendar-page-no-task-query.test.ts` (filename retained for historical/traceability reasons even though the guard mechanism changed from blocklist to allowlist — F016/F059/F060 all reference this same test). If a legitimate new `@/lib/queries/*` dependency is ever needed in the calendar subtree, add it explicitly to `ALLOWED_QUERY_MODULES` with a comment explaining why.
