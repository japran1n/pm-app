# Handoff: F016 — Remove task fetch from Planner page; ignore stale task-filter params

## Status
COMPLETE

## Assertions covered
AS-034: PASS — `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` no longer imports or calls `getCalendarTasks` (or any task-fetch function); `WeekGridSection` only calls `getCalendarBlocks` and `getTimeOffEntries`. Grep confirms zero references to `getCalendarTasks`/`fetchTasks`/`taskFilter` in the file.
AS-036: PASS — the page's `searchParams` type only declares `week?: string`; any `?status=`, `?priority=`, `?assigneeId=`, `?projectId=` (or other stale) params on an old bookmark are simply not read/destructured by Next.js and produce no error — the page renders normally.

## Files changed
(none by me directly — see Notes below: the target file was already in the required end state, committed by a concurrent F017 worker before I could commit my own edit)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint --max-warnings=0 "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx"` (0)
`npx vitest run tests/unit -t "calendar"` (0, 13 files / 29 tests passed)
`grep -n "getCalendarTasks|fetchTasks|taskFilter" "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx"` (0 matches)

## Decisions made
- Ran this feature in a repo where other mission workers (F015, F017) were editing the same Planner files concurrently. I made the required edit to `calendar/page.tsx` (drop the `getCalendarTasks` import/call, stop building `tasksByDate` from a real query, remove the now-dead `filters` prop threading into `WeekGridSection`) and while resolving a `git stash` conflict discovered the F017 worker had already committed (`528d66e0 feat(F017): delete calendar filter bar and its URL-param resolver`) a version of `calendar/page.tsx` that is byte-identical in outcome to what I was producing — it deletes `getCalendarTasks`/`CalendarFilters`/`resolveCalendarFilters` entirely and narrows `searchParams` to `{ week?: string }` only. My working copy ended up with zero diff against `HEAD` after that commit, so there is nothing left for me to commit for this feature's own file.
- Left `getCalendarTasks` itself (`lib/queries/calendar.ts`) in place rather than deleting it, per the spec's "only if it has no other callers" condition — `tests/integration/f232-calendar-query.test.ts` and `tests/integration/f235-calendar-filters.test.ts` still call it directly to exercise the query function in isolation.
- Did not touch `app/(workspace)/w/[workspaceSlug]/tasks/` or any My Tasks route, per spec.

## Out-of-scope work needed
- `components/calendar/week-view.tsx`, `week-time-grid.tsx`, `week-agenda.tsx` still have in-progress, uncommitted changes from another worker (F015 "remove task fetch/UI" territory) at the time I ran my gate commands — `week-time-grid.tsx` had already dropped its `tasksByDate` prop while `week-view.tsx` still declared/passed one, which produced transient `tsc` failures unrelated to my file. By the time I re-ran `tsc --noEmit` after F017's commit landed, the tree was self-consistent again and `tsc` passed clean — but this is a pre-existing cross-feature integration point (F015's own scope) I did not touch.
- `getCalendarTasks` (`lib/queries/calendar.ts`) and its dedicated test files (`tests/integration/f232-calendar-query.test.ts`) still exist since the query function still has callers; whichever feature (per plan.md, likely F019 "delete obsolete task tests") is responsible for retiring those should decide whether to delete the function itself once its last test caller is removed.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Verified the assigned assertions (AS-034, AS-036) are satisfied by the already-committed state of `calendar/page.tsx` rather than re-committing a duplicate diff, since git showed zero difference between my intended edit and what F017's concurrent commit had already produced.

## Notes for the next worker
- This mission's worker run appears to have multiple features' workers editing overlapping Planner files concurrently (F015/F016/F017 all touch `app/(workspace)/w/[workspaceSlug]/calendar/`). If you pick up F015 next, check `components/calendar/week-view.tsx` and `week-time-grid.tsx` for a stale `tasksByDate` prop mismatch before trusting a green `tsc` — it can flip between green/red depending on which of the concurrent edits landed most recently.
- No MCP tools were needed for this feature (pure application-code removal, no external service state).
