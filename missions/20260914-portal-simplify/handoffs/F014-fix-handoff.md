# Handoff: F014 — M2 scrutiny fix: for-you partial-failure honesty

## Status
COMPLETE

## Assertions covered
AS-009: PASS — chip count hidden (not "0") when its own source failed.
AS-010: PASS — failed getDecisionOwners shows "for-you-owners-error" hint instead of silently disabling actions.
AS-011: PASS — positive empty state gated on both sources succeeding.

## Files changed
app/(portal)/portal/[workspaceSlug]/p/[projectId]/for-you/page.tsx
tests/unit/f014-for-you-failure-states.test.tsx

## Commands run
`npx vitest run tests/unit/f014-for-you-failure-states.test.tsx` (0)
`npx tsc --noEmit -p .` (no new errors in touched file)

## Decisions made
- The owners-error banner only renders when at least one visible item is a decision (there's nothing to warn about otherwise) -- computed with `visibleItems.some(item => item.kind === "decision")`.
- Kept the existing per-source error `EmptyState`s (decisions/materials) unchanged; added the owners banner as a third, independent one rather than merging into an existing message, since it describes a different failure (owner lookup, not the approval/deliverable read itself).
- Test mocks `ApprovalCard`/`DeliverableRow`/`ApprovalHistory` to lightweight stubs so the test only depends on the page's own failure-branching logic, not those components' internals.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
None beyond what's documented above.

## Notes for the next worker
No MCP usage — pure application code + tests, no live external service state touched.
