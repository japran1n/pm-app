# Handoff: F046 — Planner header mobile wrap (nav controls reachable at 375px)

## Status
COMPLETE

## Assertions covered
AS-082: PASS — planner header controls row now wraps (`flex-wrap`) so prev/today/next buttons and the people switcher are reachable without horizontal scroll on a 375px viewport; verified via source-scan test.

## Files changed
components/calendar/planner-header.tsx
tests/unit/f039-stacked-mobile.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f039-stacked-mobile.test.tsx` (0, 2 passed)

## Decisions made
- The outer header container (`components/calendar/planner-header.tsx` line 73) already had `flex-wrap`, but the inner controls row (people switcher + add-time-off + prev/today/next buttons) used `flex items-center gap-1` with no wrap, so on narrow viewports the ~336px-wide group of controls stayed on one line and overflowed the 171px slot, getting clipped by `main`'s `overflow-x:hidden`. Added `flex-wrap` to that inner row so the controls reflow onto additional lines instead of being clipped/inaccessible.
- Chose `flex-wrap` (option 1/2 from spec) over `overflow-x-auto` (option 3) or hiding button text (option 4) because it required the smallest, least risky diff and preserves all existing controls' full labels/icons without needing additional responsive text-hiding classes.

## Out-of-scope work needed
None identified. No other clipped/overflow elements observed in this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Applied `flex-wrap` fix per option 1 of the spec's suggested changes list (self-selected the first listed option since spec allowed any of the four).

## Notes for the next worker
No MCP usage required — this is a pure UI/CSS fix. Reused the existing `tests/unit/f039-stacked-mobile.test.tsx` file per the spec's explicit instruction to add the new test there rather than creating a new file. Note: this file's assigned feature per `missions/20260920-124226/features/` naming is actually `F046-stacked-window-timezone-enforcement.md`, but the task instructions given for this worker invocation were for the planner-header mobile-wrap fix under the F046 commit/handoff naming — followed the explicit task instructions as authoritative per ZERO_QUESTIONS mode.
