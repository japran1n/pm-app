# Handoff: F079 — Fix AS-081: atomicity test must not assert its own mock

## Status
COMPLETE

## Assertions covered
AS-081: PASS — test now asserts `success:false`, the surfaced error message, and that a single upsert() round trip occurred, instead of asserting a `committedRows.push` decision the mock itself made.

## Files changed
tests/unit/f022-atomicity-bulk-estimates.test.ts

## Commands run
`npm test -- tests/unit/f022-atomicity-bulk-estimates.test.ts` (0, 6/6 passed)
`npm test -- tests/unit/f022` (0 for our target file; pre-existing unrelated failures in tests/unit/f022-board-realtime-guard-call-site.test.tsx — see Out-of-scope below)
`npx tsc --noEmit` (1, pre-existing unrelated error in tests/unit/f070-architecture-details-readback.test.ts, not touched by this feature)
`npm run lint` (0 errors, 7 pre-existing warnings in unrelated files)

## Decisions made
- Chose the "mock does not decide atomicity" approach: the fake `upsert()` now unconditionally pushes every row it receives into `attemptedRows` regardless of whether the call is reported as success or failure. This removes the self-referential `if (hasFailingRow) { skip push }` branch that the old test then asserted (`committedRows.toHaveLength(0)`), which was really just re-checking the mock's own logic.
- Replaced the atomicity claim with what a unit test can honestly prove: (1) the whole batch — including "clear" entries — is sent via exactly ONE `upsert()` call (`upsertCallCount === 1`), which is the mechanism that makes Postgres's real all-or-nothing guarantee for a single multi-row statement applicable; (2) no separate `delete()` call exists that could commit independently; (3) failures surface as `result.success === false` with a non-empty `result.error` and a logged error — genuine assertions on the production code's return value, not the mock's internal state.
- Left the true "does Postgres actually roll back a mid-batch failure" claim to the integration suite (`tests/integration/f017-new-discipline-estimates.test.ts`), documented in file-header comments, per the spec's own analysis that integration tests need a live DB and are not in the green set here.
- Renamed test IDs to `test_AS_080_*` variants that reflect the honest claim ("single round trip", not "partial state"), keeping AS-080 coverage in this file (that assertion belongs to a different feature per plan.md, but the test file covers both AS-080 and AS-081 together as before — this feature (F079) only had AS-081 assigned; AS-080's wording in the test names was adjusted incidentally since it shares the same file and mock).

## Out-of-scope work needed
- `tests/unit/f022-board-realtime-guard-call-site.test.tsx` has 5 pre-existing failing tests (`TypeError: Cannot read properties of undefined (reading 'getSession')` in `lib/realtime/subscribe-when-authenticated.ts`), unrelated to this feature and not modified here. A future feature should investigate a missing/broken Supabase client mock in that test file.
- `npx tsc --noEmit` reports one pre-existing type error in `tests/unit/f070-architecture-details-readback.test.ts` (line 83, Promise executor typing), unrelated to this feature.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Followed fix option 2+3 from the spec (rewrite test to assert genuine production-code observations: call count, no delete, explicit error result) rather than option 1 (moving the push before the error check) alone, because option 1 by itself would have made `attemptedRows` non-empty on failure but the original assertions expected empty-on-failure — those assertions had to be replaced entirely with round-trip-count and delete-absence assertions to keep the "atomicity-supporting" claim honest, exactly as the spec's option 2/3 describes.

## Notes for the next worker
No MCP tools were needed — this is a pure unit-test fix touching only mock/test code, no live schema or service state involved.
