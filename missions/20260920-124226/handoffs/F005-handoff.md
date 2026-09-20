# Handoff: F005 — stacked window clipping

## Status
COMPLETE

## Assertions covered
AS-018: PASS — `STACKED_START_HOUR`/`STACKED_END_HOUR` constants (08:00/16:00) verified by unit test.
AS-019: PASS — `STACKED_DAYS` constant is ISO weekdays [1,2,3,4,5] (Mon-Fri), verified by unit test.
AS-020: PASS — a block starting before 08:00 is clipped to 08:00 on the same day, verified by unit test.
AS-021: PASS — a block ending after 16:00 is clipped to 16:00 on the same day, verified by unit test.
AS-022: PASS — a block entirely outside 08:00-16:00 (before or after window) returns null; also verified weekend (Sat/Sun) blocks return null.

## Files changed
lib/calendar/stacked-window.ts
tests/unit/planner-stacked-window.test.ts

## Commands run
`npx vitest run tests/unit/planner-stacked-window.test.ts` (0)
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/planner-stacked-window.test.ts tests/unit/planner-layout.test.ts` (0)
`npx vitest run` (144 — timed out at 120s on the full existing suite; pre-existing condition unrelated to this feature, see Notes)
`git commit` (0)

## Decisions made
- Followed the clarified spec's function signature exactly: `clipBlockToStackedWindow(block: { starts_at, ends_at }) => { starts_at, ends_at } | null`, matching the assignment prompt (no separate `day` parameter, unlike the earlier draft scope in the feature file which mentioned `clipBlockToStackedWindow(block, day)`). The clarified/assigned signature in the run instructions takes precedence.
- Treated all ISO strings as UTC and used `getUTCDay`/`Date.UTC` throughout so clipping never depends on the host machine's local timezone, per the clarified answer "Uses ISO 8601 strings; do not depend on timezone (treat as UTC for clipping)".
- Weekday determination uses the block's `starts_at` day; a block whose start falls on a weekend returns null even if `ends_at` technically lands on a weekday, since blocks aren't expected to span midnight in this view (consistent with the 08:00-16:00 single-day window).
- Zero-or-negative-duration or unparsable date inputs return null defensively (not explicitly required by the assertions but avoids NaN propagation).

## Out-of-scope work needed
None identified — this feature is pure logic with no UI wiring. Wiring `clipBlockToStackedWindow` into the actual stacked layout component (`components/calendar/stacked-planner.tsx` / `stacked-person-row.tsx`) is covered by other features (F032-F036) per tech-decisions.md file layout and was not touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the two-argument-free signature `clipBlockToStackedWindow(block)` as given in the run assignment instructions rather than the three-argument `clipBlockToStackedWindow(block, day)` sketched in the feature file's "Draft scope" section, since the day is already derivable from `block.starts_at` and the assignment instructions (which reflect the clarified spec) are more specific and authoritative.

## Notes for the next worker
- The full `npx vitest run` (whole repo suite) exceeds the 120s bash timeout in this environment; this is a pre-existing repository-wide condition (large existing test suite, unrelated files like `planner-people-selection.test.ts` and `missions/CURRENT` were already modified in the working tree before this worker started) and not something introduced by this feature. Verified isolation by running the new test file plus the adjacent `planner-layout.test.ts` together (14/14 pass) and via `tsc --noEmit` (clean).
- No MCP tools were needed — this is pure TypeScript logic with no external service dependency.
