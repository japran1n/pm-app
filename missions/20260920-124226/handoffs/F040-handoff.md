# Handoff: F040 — End-to-end specs

## Status
COMPLETE

## Assertions covered
AS-077: PASS — `parsePeopleParam(undefined, {selfId, activeMemberIds})` returns `[selfId]` only; verified `other-id` is absent.
AS-078: PASS — `resolvePlannerLayout(2)` returns `"stacked"`; sibling check `resolvePlannerLayout(1)` returns `"week-grid"`.
AS-079: PASS — `CalendarBlockChip` rendered with a block owned by another member has `data-draggable="false"` and no `onpointerdown` listener wired up; sibling check confirms the viewer's own block gets `data-draggable="true"`.

## Files changed
tests/unit/f040-e2e-assertions.test.tsx

## Commands run
`npx vitest run tests/unit/f040-e2e-assertions.test.tsx` (0) — 4 passed
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f040-e2e-assertions.test.tsx --max-warnings=0` (0)
`npx vitest run` (0, but 292/885 test files pre-existing-failed — see Notes)

## Decisions made
- Followed the spec's approach exactly for AS-077 and AS-078 (direct calls to `parsePeopleParam` / `resolvePlannerLayout`), no deviation needed.
- For AS-079, deviated from the spec's suggested approach of rendering `StackedPersonRow` and asserting `queryAllByTestId(/drag-handle/)` is empty. Read `components/calendar/stacked-person-row.tsx` and confirmed it renders blocks as plain `<div>`s with zero dnd-kit wiring — there is no drag-handle testid to query at all in that component, and the only real drag affordance for a calendar block in this codebase lives in `components/calendar/calendar-block-chip.tsx` (F022's `canDrag && isOwnBlock(...)` gate, `data-draggable` attribute, dnd-kit `useDraggable` listeners). Testing `StackedPersonRow` directly would have been vacuously true (no drag handles exist anywhere in that component, regardless of ownership) and wouldn't actually exercise the ownership gate the assertion is about. Testing `CalendarBlockChip` instead exercises the real ownership-gated drag logic and is falsifiable (a sibling assertion proves the same component DOES render a drag handle for the viewer's own block, ruling out "nothing is ever draggable" as a trivial pass).
- Added a negative sibling test for each assertion (own block IS draggable; single selection stays week-grid) per the validation-contracts skill's "negative cases explicit" rule, even though only one test name per assertion ID was strictly required.

## Out-of-scope work needed
None identified for this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Tested AS-079 against `CalendarBlockChip` (the component that actually implements the drag gate) rather than `StackedPersonRow` (which has no drag affordance of any kind, own or other's) as literally suggested in the spec's example snippet, because the literal suggestion would produce a vacuous test. This is a stricter, more faithful test of the same assertion text ("another member's block cannot be dragged"), not a scope change — no new files/components touched beyond the one test file the spec assigned.

## Notes for the next worker
- Full-suite `npx vitest run` shows 292/885 test files failing pre-existing (unrelated to this change — confirmed via `git status --short` that no tracked file other than the new test file was touched, and the new test file is not among the failures). This is pre-existing repo state, not introduced by F040. Orchestrator may want a dedicated feature to investigate/triage the pre-existing suite failures if not already tracked elsewhere.
- No MCP tools used — this feature is pure unit-test logic with no external service touched.
