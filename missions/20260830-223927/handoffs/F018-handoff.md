# Handoff: F018 — Fix priority clear-to-null test (FU-H)

## Status
COMPLETE

## Assertions covered
AS-007: PASS — `test_AS_007_clearing_priority_to_null_updates_immediately_before_the_server_responds` now genuinely discriminates. Verified by temporarily reverting the production fix in `components/task/task-detail-sheet.tsx` (`(optimisticPriority ?? task.priority) ?? NO_PRIORITY_VALUE`) and confirming the test fails (`Expected: "__none__" / Received: "high"`), then restoring the fix and confirming all 4 tests pass.

## Files changed
tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx` (0) — 4 passed
`npx vitest run tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx` against manually-reverted `??` production code (1) — 1 failed as expected, confirming discrimination, then reverted the manual production-code change back before committing
`npm run lint` (0) — 0 errors, 13 pre-existing warnings unrelated to this file
`npx tsc --noEmit` (0)

## Decisions made
- The `SelectValue` mock previously always returned `null`, so any assertion depending on its rendered text was vacuous. Rewired it to call the real render-prop `children(value)` against the per-instance `latestValue` snapshot (same snapshot pattern already used by `SelectContent` in this file), so the badge text now reflects the actual value bound to the `Select`.
- Added a `badgeText()` helper that clones the priority field's DOM subtree and strips the native `<select>` (whose `<option>`s always list every priority label regardless of current value) so the isolated text reflects only the SelectValue-rendered badge, not option noise.
- Added a pre-clear assertion (`badgeText()).toContain("High")`) before firing the clear event, and post-clear assertions for both `toContain("No priority")` and `not.toContain("High")`, on top of the existing `prioritySelect.value` check — this is what makes the test fail if F014's ternary fix regresses back to `??`.
- No production code was touched; this is a test-only fix as the spec requires. The manual revert used to prove discrimination was applied and then restored before running lint/tsc/commit, and is not part of the committed diff.

## Out-of-scope work needed
None identified.

## Blockers
None.

## Autonomous decisions
None — spec was unambiguous (test-only fix, must fail if F014 fix reverts).

## Notes for the next worker
To reproduce the discrimination check: replace the `Select`'s `value` prop in `components/task/task-detail-sheet.tsx` (around line 1469) with `(optimisticPriority ?? task.priority) ?? NO_PRIORITY_VALUE` and re-run the F004 test file — it should fail on the AS-007 clear-to-null test with `Expected: "__none__" / Received: "high"`. No MCP tools were needed for this test-only change.
