# Handoff: F099 — Fix AS-022 block top position (kill hardcoded top:0% survivor)

## Status
COMPLETE

## Assertions covered
AS-022: PASS — added `test_AS_022_block_top_position_nonzero` (block starting at 10:00 → top 25%, height 12.5%). Verified the mutation `top: "0%"` hardcoded now fails this test (confirmed manually, then reverted).

## Files changed
tests/unit/f033-stacked-row-grid.test.tsx

## Commands run
`npx tsc --noEmit` (1 — pre-existing failure in tests/integration/calendar-blocks-crud.test.ts:397 unrelated to this change; confirmed present on `git stash` of my diff too)
`npx eslint tests/unit/f033-stacked-row-grid.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f033-stacked-row-grid.test.tsx` (0, 6 passed)
Manual mutation check: temporarily hardcoded `top: "0%"` in components/calendar/stacked-person-row.tsx, re-ran the targeted vitest file — new test failed as required (Expected "25%", Received "0%"), then reverted the component file (confirmed no diff remains).

## Decisions made
- Test file is `tests/unit/f033-stacked-row-grid.test.tsx` (spec text referenced `f033-stacked-person-row.test.tsx`, which doesn't exist — found the real file via grep for `StackedPersonRow`).
- Used a fully-inside-window block (10:00-11:00, not clipped) rather than another clipped fixture, to keep the new assertion's cause-and-effect obvious: top=25% comes straight from `percentOffset`, isolating the mutation target precisely.
- Did not touch the component (`stacked-person-row.tsx`) — the bug was in test coverage, not behaviour; AS-022's existing clipped-block test (top 0%, height 25%) was already correct, just insufficiently falsifiable alone.

## Out-of-scope work needed
None identified for this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Located the real test file by grepping for `StackedPersonRow` usages since the exact filename in the spec (`f033-stacked-person-row.test.tsx`) didn't exist in the repo; used `f033-stacked-row-grid.test.tsx` instead, which is the file that already contained the AS-018..AS-022 suite referenced by the spec.

## Notes for the next worker
- `npx tsc --noEmit` has a pre-existing, unrelated failure at `tests/integration/calendar-blocks-crud.test.ts:397` (arg count mismatch) that predates this change — visible even with this feature's diff stashed. Someone should fix it in a dedicated follow-up if it's blocking a milestone gate.
- Note: `git commit` in this session also picked up `tests/unit/f098-week-grid-24h.test.tsx`, which was already staged in the git index (untracked-but-added) from a previous worker's uncommitted work before I started — I did not author or intentionally stage that file. It is legitimate F098 test content; flagging so the orchestrator knows F098's changes are now committed as a side effect of this commit rather than under F098's own commit message.
