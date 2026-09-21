# Handoff: F018 — mobile-sheet-test

## Status
COMPLETE

## Assertions covered
SB-009: PASS — new 375px test opens the Sheet via "Open navigation" and asserts the nav tree inside `within(getByRole("dialog"))`; f006 query fixed.

## Files changed
tests/unit/f018-sidebar-mobile-sheet.test.tsx (new)
tests/unit/f006-sidebar-density-fade.test.tsx
missions/20260921-212654/handoffs/F018-handoff.md

## Commands run
`npx vitest run tests/unit/f018-sidebar-mobile-sheet.test.tsx tests/unit/f006-sidebar-density-fade.test.tsx` (0, 5 passed)
`npx vitest run tests/unit` (non-zero as at baseline; 46 failing files)
`npx tsc --noEmit` (0 errors)
`npx eslint <two touched test files>` (0)

## Decisions made
- Failing-file diff vs baseline-failing-files.txt (47): new failures = none; no longer failing = tests/unit/f041-final-gate.test.tsx (likely flaky, not from this change). 46 vs 47.
- Test-only change; no component code touched. jsdom has no layout, so 375px is set via window.innerWidth; the Sheet is JS-controlled (unmounted until the hamburger is clicked), so the dialog assertions are real.
- f006 SB-009 test now clicks the real hamburger and asserts a Dashboard link inside the dialog, replacing the /menu/i query that matched the desktop AccountMenu trigger.
- Sheet checks: Dashboard/My Tasks/Watching links, "Plan" heading, single Team link, Tools toggle button (aria-expanded), Projects heading plus project link, "Account menu" trigger.

## Out-of-scope work needed
None new. FU-3..FU-6 from M1-scrutiny remain.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Used a fixture project ("Apollo Launch") to assert the Projects section renders inside the Sheet.

## Notes for the next worker
The pre-existing uncommitted changes to layout.tsx / f120-chat-bugs test mentioned by the orchestrator were not present in the working tree when I checked; I did not touch them.
