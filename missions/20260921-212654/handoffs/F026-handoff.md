# Handoff: F026 — role-coverage-and-test-gaps

## Status
COMPLETE

## Assertions covered
SB-011: PASS — member/viewer see Members tab + page; client denied and sees no link (new tests); owner/admin/guest unchanged
SB-023: PASS — computed-height measured for project-nav-list rows (32px desktop, >=44px mobile) in real Chromium
SB-004: PASS — vitest-exclude test now runs `vitest list` with a planted .claude/ probe file; verified it fails when the exclude is removed

## Files changed
app/(workspace)/w/[workspaceSlug]/settings/page.tsx
components/nav/app-sidebar.tsx
tests/unit/f022-sb011-settings-members.test.tsx
tests/unit/f022-sb023-computed-height.test.ts
tests/unit/f016-vitest-exclude-worktrees.test.ts
tests/unit/f001-merge-team-members.test.tsx
tests/unit/f005-sidebar-tools-collapsible.test.tsx
missions/20260921-212654/handoffs/F026-handoff.md

## Commands run
`npx vitest run tests/unit` (1; failing-file set vs baseline-failing-files.txt: no new failures; only difference is f041-final-gate.test.tsx (known flaky) passed this run)
`npx vitest run <5 touched test files + optimistic-pending-audit>` (0)
`npx tsc --noEmit` (0)
`npx eslint <touched files>` (0)

## Decisions made
- Members tab on the Settings page now gated by canViewMembersList (same predicate as the members page).
- SignOutButton: kept the export (optimistic-pending-audit.test.tsx exercises it, AS-497/499) and corrected its doc comment to say it is no longer rendered by AppSidebar. Dropping it would delete that coverage.
- SB-021 filter: now asserts console.error was never called (matches the contract's "without console errors").
- f001 test: removed the SB-001 run-log assertion and its unused fs/path imports.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: chose "fix doc comment" over "drop export" for SignOutButton (see above).

## Notes for the next worker
The vitest-exclude test spawns `npx vitest list` (~1s) and briefly creates/removes .claude/f026-probe/.
