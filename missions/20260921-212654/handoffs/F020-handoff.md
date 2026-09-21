# Handoff: F020 — guest-gating-tests

## Status
COMPLETE

## Assertions covered
SB-006: PASS — component now gates Settings and Preview as client on !isGuest; guest tests use isGuest:true + canManageWorkspace:true + hasClient (mocked membership) and open the menu. Mutation check (guard removed) makes 3 tests fail.

## Files changed
components/nav/account-menu.tsx
tests/unit/f003-dissolve-other-group.test.tsx
tests/unit/f004-preview-as-client-account-menu.test.tsx
tests/unit/app-sidebar-settings-nav.test.tsx
missions/20260921-212654/handoffs/F020-handoff.md

## Commands run
`npx vitest run tests/unit` (exit 1 from pre-existing baseline failures; 46 failing files vs baseline 47; failing files not in baseline: none)
`npx vitest run` on the 4 touched/related test files incl. f002-account-menu (0; 22 tests pass)
`npx tsc --noEmit` filtered to touched files (0 errors in touched files)
`npx eslint` on touched files (0)

## Decisions made
- hasClient is not an AppSidebar prop (comes from useMembership), so f003 and settings-nav tests mock membership-provider with hasClient:true (f004 already did).
- Removed `if (aside)` guard; replaced with expect(aside).not.toBeNull().
- f002-account-menu.test.tsx untouched (F019 tests intact).

## Out-of-scope work needed
None.

## Blockers
None.

## Autonomous decisions
None.

## Notes for the next worker
Failing-file diff vs baseline: no new failures (46 now, 1 fewer than baseline).
