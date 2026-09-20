# Handoff: F070 — Fix AS-055 overflow count (default maxVisibleAvatars)

## Status
COMPLETE

## Assertions covered
AS-055: PASS — added two new tests exercising the production default `maxVisibleAvatars=3` (not explicitly passed). One selects 5 members and asserts exactly 3 avatars + "+2" overflow; the other selects 4 members and asserts overflow equals `selectedCount - defaultMaxVisibleAvatars` = "+1". Verified by mutation: temporarily changed the default from 3 to 5 in `people-switcher.tsx` — both new tests failed (avatar count 4 vs expected 3); reverted default back to 3, all 9 tests in the file pass again.

## Files changed
tests/unit/people-switcher-multiselect.test.tsx

## Commands run
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (0) — 9 passed, with default maxVisibleAvatars=3 restored
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (1, expected) — after mutating default 3→5 in components/calendar/people-switcher.tsx, 2 tests failed as required by the gate; then reverted

## Decisions made
- Added a 5th member (`user-5`) to the fixture set for the "5 selected, no explicit max" test since the shared `members` array only has 4 entries; kept the shared 4-member array unchanged and untouched by other tests.
- Second new test reuses existing 4-member fixture with default omitted, computing expected overflow via `selectedCount - defaultMaxVisibleAvatars` (3) rather than a hardcoded "+1" string, per spec instruction #2, so intent is explicit in the test itself.
- Did not modify `components/calendar/people-switcher.tsx` — it was used only as a mutation target to confirm test sensitivity, then reverted to its original state (default `maxVisibleAvatars = 3`).

## Out-of-scope work needed
None identified for this feature. Note: `components/calendar/people-switcher.tsx` has an unrelated pre-existing uncommitted change on disk (`className="hidden"` added to `PopoverTrigger`, duplicate `className` prop) that predates this worker's session and was not introduced or touched by this feature — flagging for orchestrator awareness only, not fixed here since it's outside F070's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a locally-scoped 5th fixture member (`user-5`, "Hedy Lamarr") for the 5-selected test instead of expanding the shared top-level `members` array, to avoid affecting other tests in the file that assert exact lengths against the original 4-member list.

## Notes for the next worker
The gate's mutation check (`change default maxVisibleAvatars from 3 to 5 → test MUST FAIL`) was manually verified via `sed` during this session and confirmed both new tests fail as expected; the file is restored to its original default of 3 in the final committed state.
