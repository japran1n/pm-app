# Handoff: F030 — remove Request item from + New menu

## Status
COMPLETE

## Assertions covered
SB-060: PASS — real-Chromium tests (desktop + 375px Sheet) for owner/admin with client, admin without client, member: no Request item, items == [Task, Project]. Fails when a Request item is re-added (verified: 12 tests failed under mutation).
SB-033: PASS — Task/Project clauses still hold (Request clause superseded by SB-060; contract untouched).

## Files changed
components/nav/new-menu.tsx
components/nav/app-sidebar.tsx
tests/unit/f009-sb033-sb034-new-menu.test.ts
missions/20260921-212654/handoffs/F030-handoff.md

## Commands run
`npx vitest run tests/unit/f009-sb033-sb034-new-menu.test.ts` (0, 36 passed)
Mutation: temporarily re-added Request item, same file: 12 failed (0 after restore)
`npx vitest run tests/unit` (non-zero: 46 failed files, all in baseline; diff vs baseline-failing-files.txt shows no new failures; f041-final-gate passed this run, it is baseline-flaky)
`npx tsc --noEmit -p .` (0)
`npx eslint` on touched files (0)

## Decisions made
- Removed canManageWorkspace/hasClient props from NewMenu and its call site only; both are still used elsewhere in app-sidebar/account-menu so the sidebar props remain.
- Removed the Request-only test; replaced Request-related names with SB-060 and added a dedicated SB-060 describe block.
- Menu still returns null when the user cannot create (guest/viewer), since Request was the only other reason to render.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
None.

## Notes for the next worker
Verified: real Chromium, real AppSidebar + NewMenu, both viewports. Not verified: live authenticated Next page.
