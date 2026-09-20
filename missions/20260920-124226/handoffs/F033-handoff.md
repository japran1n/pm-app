# Handoff: F033 — Stacked row grid

## Status
COMPLETE

## Assertions covered
AS-018: PASS — hours 08:00-16:00 present in DOM, 00:00-07:00 and 17:00-23:00 absent (verified via `stacked-hour-<day>-<hour>` testids)
AS-019: PASS — Mon-Fri columns (`stacked-day-1..5`) present, Sat/Sun (`stacked-day-6`, `stacked-day-7`) absent
AS-020: PASS — 17:00-18:00 block produces no clipped segments and is not rendered
AS-021: PASS — Saturday block produces no clipped segments and is not rendered on any weekday column
AS-022: PASS — 06:00-10:00 block is clipped to 08:00-10:00 (top 0%, height 25% of the 8-hour window)

## Files changed
components/calendar/stacked-person-row.tsx
tests/unit/f033-stacked-row-grid.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/calendar/stacked-person-row.tsx tests/unit/f033-stacked-row-grid.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f033-stacked-row-grid.test.tsx` (0, 5 passed)

## Decisions made
- `stacked-person-row.tsx` did not exist yet when this worker ran (F032 was still in progress and had only modified `stacked-planner.tsx`, not committed the row file), so I created it directly per the spec's fallback instruction.
- Component API: `StackedPersonRow({ userId, userLabel?, blocks, weekKey })` — `blocks` is the raw `CalendarBlock[]` for that person; the component calls `clipBlockToStackedWindow` itself per block, so callers (e.g. `StackedPlanner`) don't need to pre-clip.
- Added a same-day guard in `buildSegments` comparing the clipped segment's date against `weekKey`'s corresponding weekday date, since `clipBlockToStackedWindow` only restricts to Mon-Fri of whichever week the block's own timestamp falls in, not necessarily the week being displayed. This prevents a block from a different week (that happens to share the ISO weekday) from leaking into the wrong week's grid. Given the current single-week planner usage this is defensive but doesn't change behavior for in-scope test cases.
- Used inline absolute positioning (top/height percentages) within each day column rather than a full CSS grid per assertion note "don't over-engineer" — simplest layout that satisfies clipping/visibility assertions.
- Did not wire `StackedPersonRow` into `stacked-planner.tsx` — that composition is F032's/a later feature's responsibility per the parallel-work note in the spec ("F032 is running in parallel"); `stacked-planner.tsx` was left untouched to avoid conflicting with F032's in-flight, uncommitted edits.
- Used `getCalendarBlockDisplayColor` (existing utility from `lib/calendar/block-colors.ts`, already used by `calendar-block-chip.tsx`) for chip coloring, matching existing conventions.

## Out-of-scope work needed
- Wiring `StackedPersonRow` into `StackedPlanner` (rendering one row per selected person, ordering, headers) is not part of F033 — appears to belong to F032/F035/F036 per the feature list observed in the mission folder (stacked-shell, stacked-row-reorder, stacked-scroll-and-colour).
- No a11y roles/labels beyond basic testids/title attributes were added — F038 (stacked-a11y) covers that per the mission's feature list.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Created `stacked-person-row.tsx` from scratch since F032's version wasn't committed yet at the time this worker ran, per the spec's explicit fallback instruction ("If `stacked-person-row.tsx` doesn't exist yet ... create it yourself"). Kept the component's public props minimal (userId, userLabel, blocks, weekKey) to make it easy for F032/later features to compose without needing to know about clipping internals.

## Notes for the next worker
- Test file uses `2026-09-14` (a real Monday) as `weekKey` and `2026-09-19` (the following Saturday) for the weekend-block test — dates were verified as correct weekdays.
- No MCP tools used — this is a pure UI/presentational feature with no external service or live data dependency.
- If F032's own `stacked-person-row.tsx` work lands separately and conflicts, reconcile by keeping this file's grid/clipping logic (it's the tested contract for AS-018..AS-022) and merging in any additional props/composition F032 needs.
