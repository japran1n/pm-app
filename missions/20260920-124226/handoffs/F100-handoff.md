# Handoff: F100 — Fix AS-001/AS-059 — remove activeMemberIds concat in page.tsx

## Status
COMPLETE

## Assertions covered
AS-001: PASS — `blockUserIds` in `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` is derived solely via `buildBlockUserIds(selectedUserIds)`, no `.concat(activeMemberIds)` present. Verified by `test_AS_001_page_source_routes_blockUserIds_through_buildBlockUserIds` and the new anti-regression regex guard.
AS-059: PASS — `blockUserIds` equals `selectedUserIds` exactly with no widening to all active members. Verified by `test_AS_059_block_fetch_scoped_to_selection_not_all_members`.

## Files changed
tests/unit/f031-page-layout-derivation.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f031-page-layout-derivation.test.tsx` (0, 16 passed)
`npx next build` (0)

## Decisions made
- On inspection, `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:139` already reads `const blockUserIds = buildBlockUserIds(selectedUserIds);` with no `.concat(activeMemberIds)`. A prior worker (F090, per the inline comment at line 135-138) had already applied this exact fix ahead of this feature being picked up. No source change to `page.tsx` was needed.
- Since the code was already correct, I strengthened the regression-guard test instead of merely re-asserting the fix: added an explicit `expect(source).not.toMatch(/buildBlockUserIds\([^)]*\)\s*\.concat\(/)` assertion to `test_AS_001_page_source_routes_blockUserIds_through_buildBlockUserIds` in `tests/unit/f031-page-layout-derivation.test.tsx`. This directly encodes the described mutation (re-appending `.concat(activeMemberIds)`) as a falsifiable check, per the spec's Step 2 intent, without duplicating the existing `test_AS_059_block_fetch_scoped_to_selection_not_all_members` / source-routing tests already covering the data-flow side.
- Did not add a fully separate new test block since the existing describe block (`AS-001/AS-059: the page fetches blocks for the selected people, not every member`) already satisfies the spec's stated invariant (`blockUserIds` must equal `selectedUserIds` exactly) via `buildBlockUserIds(["u1","u2"])` returning `["u1","u2"]` and the source-regex checks; adding the concat-guard regex closes the last gap called out in the spec (mutation → FAIL).

## Out-of-scope work needed
None identified for this feature.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Spec's Step 1 (remove `.concat(activeMemberIds)`) was already done by a prior worker before this feature was picked up; treated the feature as complete once verified against current source, and focused remaining work on hardening the regression test per Step 2's stated goal (mutation-would-fail).

## Notes for the next worker
The inline comment in `page.tsx` at line 135-138 references F090 as the worker that introduced `buildBlockUserIds` as the single source of truth for `blockUserIds`, and the existing test suite in `tests/unit/f031-page-layout-derivation.test.tsx` (describe block "AS-001/AS-059...") already carries source-regex and data-flow tests for this exact regression. No MCP tools were used — this is a pure client/server component + unit test fix, no external service state touched.
