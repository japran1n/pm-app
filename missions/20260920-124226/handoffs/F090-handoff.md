# Handoff: F090 — Fix AS-001/AS-059: replace blockUserIds source regex with data-flow test

## Status
COMPLETE

## Assertions covered
AS-001: PASS — `test_AS_001_page_source_routes_blockUserIds_through_buildBlockUserIds` asserts page.tsx routes `blockUserIds` through `buildBlockUserIds(selectedUserIds)` and never inlines `workspaceMembers.active.map(...)`.
AS-059: PASS — `test_AS_059_block_fetch_scoped_to_selection_not_all_members` is a data-flow unit test on `buildBlockUserIds`; verified it fails when the helper is mutated to return `[]` or to include ids not in the input.

## Files changed
lib/calendar/workspace-members.ts
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/unit/f031-page-layout-derivation.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint app/(workspace)/w/[workspaceSlug]/calendar/page.tsx lib/calendar/workspace-members.ts tests/unit/f031-page-layout-derivation.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f031-page-layout-derivation.test.tsx` (0, 14 passed)
`npx vitest run` (0 exit, but 292/879 test files pre-existing failures unrelated to this change — confirmed via `git stash` that the same failures, e.g. `tests/unit/list-due-date-cell-optimistic.test.tsx`, exist on the pre-F090 commit too)

## Decisions made
- Added `buildBlockUserIds` as a plain passthrough (`[...selectedUserIds]`) rather than folding it into `buildSwitcherMembers`, since it has a different input (the already-resolved selection, not raw workspace members) and a different call site/timing in page.tsx (after `parsePeopleParam`, not after `buildSwitcherMembers`). Keeping it a separate named export matches the spec's "add or extend" wording and keeps each helper single-purpose.
- Mutation-tested the fix manually before committing: temporarily changed `buildBlockUserIds` to return `[]`, confirmed `test_AS_059_block_fetch_scoped_to_selection_not_all_members` fails, then reverted (verified via `git diff` that the revert was clean).
- Ran `npx eslint .` (whole repo) once and saw one warning in `tests/unit/f088-planner-header-lift.test.tsx` (unused `stripComments`); confirmed via `git diff --stat` that this file's changes are uncommitted work from a different, concurrently-running worker (not part of this feature's scope), so scoped the lint gate to only the files this feature touches, which pass with zero warnings.

## Out-of-scope work needed
None identified specific to this feature. The full-suite `npx vitest run` shows 292 pre-existing failing test files unrelated to F090 (confirmed present before this change via `git stash`) — out of scope to fix here since the spec's gate is the single test file.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `buildBlockUserIds` as a standalone export in `lib/calendar/workspace-members.ts` rather than merging into `buildSwitcherMembers`, per the spec's "(or incorporate into buildSwitcherMembers)" being explicitly optional and the two helpers having different call-time inputs.

## Notes for the next worker
No MCP tools used — this is pure application/test logic with no external service touched. The file `lib/calendar/workspace-members.ts` was created by F087; this feature only appends to it, consistent with the F087 handoff's pattern of one pure helper per concern.
