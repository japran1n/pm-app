# Handoff: F115 — Fix AS-063 fixture roster order

## Status
COMPLETE

## Assertions covered
AS-063: PASS — rows render in `selectedUserIds` (URL param) order, not roster/alphabetical order. Fixture now has `members` in alphabetical order (Alice, Bob, Carol) while `selectedUserIds` is [Carol, Alice, Bob], so the test can distinguish the two possible orderings. Verified via manual mutation (sorting `selectedUserIds` before render) that the test fails as expected, then reverted.

## Files changed
tests/unit/f032-stacked-shell.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f032-stacked-shell.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f032-stacked-shell.test.tsx` (0)
`npx vitest run tests/unit/f032-stacked-shell.test.tsx` with temporary mutation (`selectedUserIds={[...orderedSelectedUserIds].sort()}`) — confirmed test FAILS (exit 1), then reverted from backup and re-ran to confirm PASS (exit 0)

## Decisions made
- The existing fixture already had `selectedUserIds` non-alphabetical (Carol, Alice, Bob) but `members` was in the SAME order as `selectedUserIds`, so a component that iterated `members` (roster order) instead of `selectedUserIds` (URL param order) would still have passed the test. Changed only the `members` array order to alphabetical (Alice, Bob, Carol) per the clarified spec, keeping `selectedUserIds` and the DOM-order assertions (Carol < Alice < Bob) unchanged, since those were already correct.

## Out-of-scope work needed
None identified.

## Blockers
None.

## Autonomous decisions
None — followed the clarified spec's fixture ordering exactly.

## Notes for the next worker
The `StackedPlanner` component (components/calendar/stacked-planner.tsx line 163) maps directly over `selectedUserIds`, which is the correct behavior per AS-063. No production code changes were needed; this was a test-fixture-only fix.
