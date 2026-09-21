# Handoff: F035 — fail-closed-guest-and-sheet-width

## Status
COMPLETE

## Assertions covered
SB-006: PASS — layout-level test (real WorkspaceLayout, non-empty stubs): memberships error / missing row => role "guest" AND isGuest true, canManageWorkspace false; healthy admin not guest. Fails when fix reverted (2 tests red).
SB-009: PASS — Sheet is now 256px at 375px (measured in Chromium; was 281.25); 375px Sheet tests (F025 44px, F007 switcher, F009 menu) pass; staging/print matrix + sheet-close-on-create pass at 375 and 1280.

## Files changed
app/(workspace)/w/[workspaceSlug]/layout.tsx
components/nav/app-sidebar.tsx
components/nav/new-menu.tsx
components/new-project-dialog.tsx
components/workspace-switcher.tsx
tests/unit/f035-layout-guest-fail-closed.test.tsx (new)
tests/unit/f009-sb033-sb034-new-menu.test.ts
tests/unit/f025-sb009-real-375px.test.ts

## Commands run
`npx vitest run tests/unit/f035-layout-guest-fail-closed.test.tsx` (0)
`npx tsc --noEmit` (0)
`npx eslint <touched files>` (0, no output)
`npx vitest run tests/unit` (1; 47 failed files vs 46 baseline; only new file = f025-sb009-real-375px, my new test asserting equality with desktop aside; desktop aside is 240px, not 256. Fixed the test.)
`npx vitest run tests/unit/f025-sb009-real-375px.test.ts tests/unit/f007-sb030-switcher-width.test.ts tests/unit/f009-sb033-sb034-new-menu.test.ts` (0 after fix; f025 5/5, f007 + f009 pass)
Mutation checks: reverting isGuest derivation -> 2 red; removing data-[side=left]:w-64 -> width test red (281.25); removing onCreated -> close test red.

## Decisions made
- isGuest now derived from activeWorkspaceRole (declared first) in layout.tsx; other people's edits preserved (only that block changed).
- Sheet width: className "w-64 data-[side=left]:w-64 p-0" so tailwind-merge drops the base data-[side=left]:w-3/4. Result 256px at 375px (author's intent), not cramped; 44px link/tap tests and switcher tests pass. Desktop aside is a separate 240px column (task text said 256; measured 240) - left untouched; mobile Sheet is 16px wider than desktop column.
- workspace-switcher dropdown items: truncate -> min-w-0 break-words (wraps).
- Sheet close after create: added optional onCreated to NewProjectDialog, called after resetAndClose()/router.refresh() on success only; NewMenu passes onNavigate (undefined on desktop). Dialog is already closed when the Sheet unmounts it; Cancel keeps Sheet open (tested).
- Task-menu matrix now includes staging and print.

## Out-of-scope work needed
None. Optional: the workspace-switcher dropdown wrap is not covered by a dedicated long-name measurement test (existing F007 trigger tests pass; dropdown list wrapping was not measured in Chromium).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: kept 256px Sheet (author's w-64) rather than matching the 240px desktop aside.

## Notes for the next worker
Full-suite failing-file diff vs baseline: no new failures after the fix (f025 file passes in isolation and in the 3-file run). Flaky files not otherwise touched. Not verified: live authenticated Next page; workspace-switcher dropdown wrapping visually.
