# Handoff: F135 — Fix AS-179/AS-182 test traceability

## Status
COMPLETE

## Assertions covered
AS-179: PASS — added `it("AS-179: ...")` block in tests/unit/m9-regression.test.ts asserting resolveClientBucket is exported from components/portal/status-label.ts and that components/portal is not excluded in tsconfig.json.
AS-182: PASS — added "AS-182" label to the two it() blocks in tests/unit/m6-action-barrel-guard.test.ts that guard the barrel export count (EXPECTED_ACTION_COUNT) and the call-site-reference check.

## Files changed
tests/unit/m9-regression.test.ts
tests/unit/m6-action-barrel-guard.test.ts

## Commands run
`npx vitest run tests/unit/m9-regression.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (0) — 7 tests passed
`npx tsc --noEmit` (0)
`grep "AS-182" tests/unit/m6-action-barrel-guard.test.ts` (0) — 2 matches
`git commit` (0)

## Decisions made
- For AS-179, checked tsconfig.json `exclude` array (parsed as JSON) for any entry containing "components/portal" rather than assuming a specific glob syntax, since the clarified task said "not excluded" without specifying exact format.
- Placed the new AS-179 it() block inside the existing `describe("M9 regression (AS-178, AS-179, AS-180, AS-181)")` block, adjacent to the AS-178/AS-178b tests it's most related to (same file under test), and before AS-180.
- For AS-182, labeled both the barrel-count test and the call-site-reference test since both jointly guard "every exported action has a real caller, EXPECTED_ACTION_COUNT is correct" per the feature spec.

## Out-of-scope work needed
None identified.

## Blockers
None.

## Autonomous decisions
None beyond the exclude-detection approach noted above, which was a straightforward reading of the spec's instructions.

## Notes for the next worker
No MCP usage required for this feature (pure local test-file edit, no external service state touched).
