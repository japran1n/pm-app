# Handoff: F056 — Fix AS-006 ordering contract

## Status
COMPLETE

## Assertions covered
AS-006: PASS — test_AS_006_multiple_userIds_returns_blocks_for_all_specified_users now asserts set equality (arrayContaining + toHaveLength) instead of sorting the result IDs, and additionally asserts results are sorted by starts_at ascending.

## Files changed
tests/unit/calendar-blocks-people-filter.test.ts

## Commands run
`npx vitest run tests/unit/calendar-blocks-people-filter.test.ts` (0, 5 passed)
`npx tsc --noEmit` (1, but only pre-existing unrelated failures in tests/unit/switcher-member-source.test.ts referencing undefined REMOVED_USER_ID — not touched by this feature, not introduced by this change)
`npx eslint tests/unit/calendar-blocks-people-filter.test.ts --max-warnings=0` (0, no output)

## Decisions made
- Removed `.sort()` from the multi-user test's result assertion since it masked the actual returned order, defeating the purpose of AS-006/ordering verification.
- Replaced with `expect(resultIds).toEqual(expect.arrayContaining([...]))` plus `expect(resultIds).toHaveLength(2)` to assert set equality (all and only the requested users' blocks present) as specified.
- Added an additional assertion that `startsAt` values across results are non-decreasing, verifying the implementation's `.order("starts_at", { ascending: true })` is honored end-to-end, per the spec's "optionally assert" instruction.
- No changes made to `lib/queries/calendar-blocks.ts` per spec instruction — implementation was already correct.

## Out-of-scope work needed
tests/unit/switcher-member-source.test.ts has a pre-existing TypeScript error (`Cannot find name 'REMOVED_USER_ID'` at lines 123 and 137) unrelated to this feature. This causes `npx tsc --noEmit` to exit non-zero repo-wide. A future feature/fix should define or import `REMOVED_USER_ID` in that test file.

## Blockers
<none>

## Autonomous decisions
AUTONOMOUS_DECISION: Treated the pre-existing tsc failure in an unrelated test file as out of scope since the feature spec explicitly limits touches to tests/unit/calendar-blocks-people-filter.test.ts, and that file itself type-checks cleanly (isolated check not directly possible via tsc per-file for this project's config, but the reported errors are confined to the unrelated file).

## Notes for the next worker
The chainable stub builders in this test file (`makeMembersBuilder`, `makeBlocksBuilder`) are shared across all five tests in the suite; no changes were needed there. If assertion IDs referencing ordering behaviour are added in the future, follow the same pattern: assert `startsAt` (camelCase, mapped from `starts_at`) is non-decreasing rather than re-sorting the array under test.
