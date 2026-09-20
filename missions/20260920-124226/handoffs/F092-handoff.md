# Handoff: F092 — Fix AS-063: use fixture where sorted order ≠ expected order

## Status
COMPLETE

## Assertions covered
AS-063: PASS — rewrote fixture (carol-id, alice-id, bob-id) so `[...selectedUserIds].sort()` mutation now yields a different order (alice, bob, carol) than the required render order (carol, alice, bob), making the test falsifiable.

## Files changed
tests/unit/f032-stacked-shell.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f032-stacked-shell.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f032-stacked-shell.test.tsx` (0 — 3 passed)
`node -e "console.log([...['carol-id','alice-id','bob-id']].sort())"` (0 — manual mutation-kill verification: confirms sort() reorders to alice, bob, carol, which would fail the new assertions)

## Decisions made
- Kept the original ZOE/ALICE/MO fixture and its AS-024/AS-062 test untouched (they're not in scope for this fix and rely on `buildBlocksByUser()` per-user block data).
- Added a self-contained fixture (`CAROL_ID`, `ALICE_ID`, `BOB_ID` with plain string ids, not UUIDs) scoped inside the AS-063 test itself, since these ids/names only need to demonstrate ordering, not participate in the shared block-building helper.
- Used `blocksByUser={new Map()}` for this test since block content is irrelevant to ordering and AS-024 (no-blocks row) is already covered by the separate AS-024/AS-062 test above it.
- Verified via `[...ids].sort()` in Node that the chosen ids ("carol-id", "alice-id", "bob-id") do NOT sort to the same order as `selectedUserIds`, closing the gap the original ascending-UUID fixture had.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the new ids "carol-id" / "alice-id" / "bob-id" instead of UUID-format strings as literally written in the spec example, since `SwitcherMember.userId` is typed as `string` (no UUID format enforced) and this makes the mutation-kill property (`sort()` != selectedUserIds order) verifiable at a glance without needing to compute UUID lexicographic order.

## Notes for the next worker
No MCP tools used — this is a pure unit-test fix with no external service or live schema involvement.
