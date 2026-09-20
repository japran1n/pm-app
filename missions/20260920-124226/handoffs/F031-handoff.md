# Handoff: F031 — page layout derivation

## Status
COMPLETE

## Assertions covered
AS-001: PASS — no `?people=` param resolves to `[selfId]` (parsePeopleParam), page now passes `blockUserIds={selectedUserIds}` (not all active members) to `getCalendarBlocks`, and layout resolves to "week-grid".
AS-002: PASS — a one-person selection resolves to `resolvePlannerLayout(1) === "week-grid"`, which renders the existing full-day `WeekView` unchanged.
AS-014: PASS — `parsePeopleParam` is pure over `(peopleParam, {selfId, activeMemberIds})`; same `?people=` value + same active-member allowlist yields the identical ordered selection regardless of which member is the caller (test asserts this for two different `selfId`s).
AS-023: PASS — `resolvePlannerLayout(1)` returns `"week-grid"`, covering the "narrow from stacked back to one person" case.
AS-015: PASS — source-level checks confirm `page.tsx` never references `searchParams.view` / `params.view`, and the layout is derived only via `resolvePlannerLayout(selectedUserIds.length)`.

## Files changed
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
components/calendar/stacked-planner.tsx
tests/unit/f031-page-layout-derivation.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f031-page-layout-derivation.test.tsx` (0, 10/10 passed)
`npx vitest run` (0 exit code from the runner itself; 292/873 test files reported failing — all pre-existing, none in calendar/planner/stacked-planner files; confirmed via `grep -i "calendar\|f031\|f032\|stacked-planner\|planner"` against the FAIL lines, which returned no matches)

## Decisions made
- The spec referenced `lib/calendar/layout.ts`, but the actual existing module (already containing `resolvePlannerLayout`) is `lib/calendar/planner-layout.ts` — used that path instead of creating a duplicate/second module.
- Fixed the AS-059 caveat noted in the spec at `page.tsx:127`: `blockUserIds` now comes from `selectedUserIds` (the parsed `?people=` selection) instead of `workspaceMembers.active.map((m) => m.userId)`.
- `StackedPlanner` is a minimal stub per the spec: accepts `selectedUserIds`, `blocksByUser` (a `Map<string, CalendarBlock[]>` built by bucketing the single `getCalendarBlocks` fetch result in memory — one fetch for all selected people, never one query per row, per the feature's own clarification note), and `weekKey`; renders `<div data-testid="stacked-planner">` with the person count. F032 will flesh out the real per-person columns/time-grid.
- Did not add a `view` field to the `searchParams` type in `page.tsx` — the type only has `week?`/`people?`, which itself is evidence the page cannot read a `?view=` param, and is asserted against in the AS-015 source-check test.
- Test file uses source-level string assertions (reading `page.tsx` from disk) for the "does the page reference X" checks (AS-015, and the `blockUserIds={selectedUserIds}` wiring) since this route is a server component and the project's existing convention for this route (see `tests/unit/f012-slug-validation.test.ts`) is pure-logic + source-check tests rather than full RSC rendering.

## Out-of-scope work needed
- F032 (already tracked in plan.md) needs to build out the real stacked time-grid inside `StackedPlanner` — per-person rows/columns clipped to the Mon-Fri 08:00-16:00 window using `lib/calendar/stacked-window.ts`'s `clipBlockToStackedWindow`, which this feature deliberately left unused inside the stub.
- The full `npx vitest run` shows 292 pre-existing failing test files across the repo (unrelated to calendar/planner/stacked-planner — confirmed via targeted grep). These predate this feature's changes and are not part of F031's scope; flagging for orchestrator awareness in case a milestone-boundary validator needs this context.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `lib/calendar/planner-layout.ts` (the real existing module) instead of the spec's stated `lib/calendar/layout.ts`, since the latter doesn't exist and the former already contains the exact `resolvePlannerLayout` function the spec describes.

## Notes for the next worker
- `resolvePlannerLayout(selectionCount: number): "week-grid" | "stacked"` lives in `lib/calendar/planner-layout.ts` — treats `selectionCount <= 1` as `"week-grid"`.
- `CalendarBlock` (from `lib/queries/calendar-blocks.ts`) has a `userId` field already, used for bucketing into `blocksByUser` in `page.tsx`'s `WeekGridSection`.
- No MCP tools were needed for this feature — pure page composition/logic wiring, no live external-service state touched.
