# Handoff: F052 — Fix AS-003/AS-008 self-id fixtures (unfalsifiable test bug)

## Status
COMPLETE

## Assertions covered
AS-003: PASS — added test where selfId ("member-c") is NOT activeMemberIds[0]; `?people=me` still resolves to selfId
AS-008: PASS — added tests where selfId is NOT activeMemberIds[0] for null param, empty param, and all-invalid-id fallback; all correctly resolve to [selfId] rather than [activeMemberIds[0]]

## Files changed
tests/unit/planner-people-selection.test.ts

## Commands run
`npx vitest run tests/unit/planner-people-selection.test.ts` (0) — 35 passed
`npx tsc --noEmit` (0)
`npx eslint tests/unit/planner-people-selection.test.ts --max-warnings=0` (0)

## Decisions made
- Added the 4 tests exactly as specified in the feature spec, inserted immediately before the existing "defaults to [selfId] when no param is present" test, using a fixture where selfId ("member-c") is the last element of activeMemberIds rather than the first — this makes AS-003/AS-008 falsifiable against implementations that accidentally default to activeMemberIds[0] instead of the actual selfId.
- Did not touch `lib/calendar/people-selection.ts` per spec (implementation is out of scope; it already passes the new tests, confirming the underlying logic was correct all along and the bug was only in the test fixtures).

## Out-of-scope work needed
None identified beyond this fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was unambiguous and followed exactly)

## Notes for the next worker
No MCP usage required for this feature (pure unit test file, no external service state). The existing SELF_ID/ACTIVE_MEMBER_IDS module-level constants were left unchanged since other tests in the file depend on SELF_ID being at index 0 for AS-004 "all" ordering assertions; the new tests use their own inline fixtures instead.
