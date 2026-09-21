# Handoff: stacked-time-ruler — Match stacked layout visual to single-person week grid

## Status
COMPLETE

## Assertions covered
This is a visual-parity follow-up task (not tied to a numbered F<NNN> spec with
assigned assertion IDs). It touches the stacked planner covered by AS-018/AS-019
(the fixed 08:00-16:00 window) — both remain satisfied since the window and
clipping logic (`clipBlockToStackedWindow`, `STACKED_START_HOUR`,
`STACKED_END_HOUR`) were not changed, only the visual rendering around them.
AS-018: PASS — window still 08:00-16:00, unchanged clip logic, verified by existing f033/f036 test suites passing.
AS-019: PASS — same as above.

## Files changed
components/calendar/stacked-person-row.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/calendar/stacked-person-row.tsx --max-warnings=0` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f033-stacked-row-grid.test.tsx tests/unit/f036-stacked-scroll-colour.test.tsx` (0, 18 passed)

## Decisions made
- Added a left-hand time ruler column (`w-12`, i.e. 3rem) with hour labels
  08:00..16:00, styled to match `week-time-grid.tsx`'s own axis: muted,
  font-mono, right-aligned "HH:00" labels. Used a flex wrapper
  (`time ruler` + `grid` day columns) rather than folding the ruler into the
  existing 5-col grid template, to avoid touching the day-column grid's
  column count (which several existing tests/selectors — `stacked-grid`,
  `stacked-day-N`, `stacked-hour-N-H` — depend on staying a 5-column grid).
- The existing time-off strip (`stacked-time-off-strip`) sits above the grid
  and needed to stay visually aligned with the day columns despite having no
  counterpart in the ruler row; added `ml-12 w-[calc(100%-3rem)]` to shift it
  right by exactly the ruler's width rather than reworking it into the same
  flex layout, keeping its own DOM/test structure (5-col grid, one
  `TimeOffDayStrip` per day) fully unchanged.
- Reused `formatBlockTimeRange` from `lib/calendar/block-datetime` (the same
  helper `week-time-grid.tsx`'s `WeekBlockChip` uses) so the time-range text
  format ("11:15 AM–1:45 PM") is byte-identical between single-person and
  stacked views — not a reimplementation.
- Time label shows the block's *original* `startsAt`/`endsAt` (not the
  window-clipped segment times), matching how `WeekBlockChip` shows the
  block's real start/end even for a block whose visible chip might be
  scrolled to only show it partially — same posture, since the stacked
  window-clip is a rendering constraint only, not a time change.
- height >= 40px threshold: `HOUR_ROW_PX = 40` matches the existing
  `HOURS.length * 2.5rem` per-hour row height (2.5rem = 40px at default root
  font size), so a block spanning slightly under an hour already clears the
  threshold and shows time; anything shorter (rare, sub-~35min visible
  segment) shows title only per the spec's explicit instruction.
- Block chip content changed from a single truncated line to a
  `flex flex-col` with a title line (font-medium) and an optional time line
  (text-muted-foreground) — mirrors `WeekBlockChip`'s two-line chip
  structure exactly.

## Out-of-scope work needed
None identified. This was a pure visual-parity pass; no data model, query, or
business-logic files were touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the existing `data-testid="stacked-grid"` and
`stacked-day-{isoWeekday}` / `stacked-hour-{isoWeekday}-{hour}` test ids and
the day-column grid's 5-column template completely unchanged, adding the
ruler as a sibling flex item instead, specifically so f033/f036's existing
assertions about grid shape and per-day/per-hour structure keep passing
without modification.

AUTONOMOUS_DECISION: Added new test ids (`stacked-time-ruler`,
`stacked-ruler-hour-{hour}`, `stacked-block-time-{blockId}-{isoWeekday}`) for
the new elements rather than reusing week-time-grid's ids, since the two
components render into different DOM trees and per-person-row uniqueness
(the block time id includes `isoWeekday` like the existing block id does)
matters for the stacked view's multiple rows/columns.

## Notes for the next worker
- No MCP tools used — this is a pure UI/component change with no external
  service or database involvement.
- If a future feature adds a dedicated assertion ID for stacked-view time
  labels/ruler, a good place to look is `tests/unit/f033-stacked-row-grid.test.tsx`,
  which already asserts on grid/day/hour test ids and would be the natural
  home for new assertions on `stacked-time-ruler` / `stacked-block-time-*`.
- Visual review not done via a running preview server (no dev server was
  started for this pass); verified purely via tsc/eslint/vitest gates per
  the task's own Step 5 instructions.
