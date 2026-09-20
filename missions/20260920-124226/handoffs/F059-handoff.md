# Handoff: F059 — Add planner purity guards

## Status
COMPLETE

## Assertions covered
AS-033: PASS — `tests/unit/f015-remove-task-strips.test.tsx` now renders `<WeekView>` with 5 calendar blocks + 2 time-off entries and scans every `data-testid` in the tree, asserting none contains `task`, `allday-chip`, or `agenda-task`.
AS-034: PASS — `tests/unit/f016-calendar-page-no-task-query.test.ts` reads the source of the calendar page, week-view, week-time-grid, and week-agenda files and asserts none references `@/lib/queries/calendar`, `@/lib/queries/tasks`, or `getCalendarTasks`, plus asserts the page's `searchParams` type has no `status`/`priority`/`assigneeId`/`projectId`/`taskId` fields.

## Files changed
tests/unit/f015-remove-task-strips.test.tsx
tests/unit/f016-calendar-page-no-task-query.test.ts

## Commands run
`npx vitest run tests/unit/f015-remove-task-strips.test.tsx tests/unit/f016-calendar-page-no-task-query.test.ts` (0, 24 passed)
`npx tsc --noEmit` (0)

## Decisions made
- Took the render-based approach for AS-033 (spec's primary option) rather than the source-text fallback, since WeekView rendered cleanly in jsdom with realistic fixtures (5 blocks across the week + 2 time-off entries) — no heavy mocking needed.
- Used quoted forms (`"@/lib/queries/calendar"` / `'@/lib/queries/calendar'`) for the AS-034 import-string check instead of a bare substring, because a bare substring check false-positives on the legitimate `@/lib/queries/calendar-blocks` import that week-view.tsx and the page do use. This still catches static and dynamic imports of the actual `@/lib/queries/calendar` and `@/lib/queries/tasks` modules while not flagging the unrelated `calendar-blocks` module.
- Read `searchParams` type via regex extraction of the `Promise<{...}>` block in the page source, then checked for forbidden field names within just that captured type text (not the whole file), avoiding false positives from comments elsewhere in the file.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none beyond the decisions documented above, which followed the spec directly)

## Notes for the next worker
No MCP tools were needed for this feature — it's pure test authoring against existing source files, no external service state involved. Note: at commit time, the working tree already had unrelated pre-existing staged deletions (`tests/integration/f234-calendar-drag-reschedule.test.ts`, `tests/unit/f009-workspace-status-options-project-scan.test.ts`) and a modified `tests/integration/edit-task.test.ts` / `missions/.../plan.md` from prior work in this session before F059 started; only `tests/unit/f015-remove-task-strips.test.tsx` and `tests/unit/f016-calendar-page-no-task-query.test.ts` were touched by this feature, but since those other changes were already staged in git's index they landed in the same commit. Worth confirming with the orchestrator that those pre-existing staged deletions were intentional from an earlier step.
