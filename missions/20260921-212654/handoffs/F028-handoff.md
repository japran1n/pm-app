# Handoff: F028 — new-project-opens-dialog

## Status
COMPLETE

## Assertions covered
SB-033: PASS — "+ New -> Project" now opens the real NewProjectDialog in place; verified in real headless Chromium at 1280 (desktop aside) and 375 (mobile Sheet).

## Files changed
components/new-project-dialog.tsx
components/nav/new-menu.tsx
components/nav/app-sidebar.tsx
tests/unit/f009-sb033-sb034-new-menu.test.ts
missions/20260921-212654/handoffs/F028-handoff.md

## Commands run
`npx vitest run tests/unit/f009-sb033-sb034-new-menu.test.ts` (0, 20 passed)
Same file with the wiring removed (Project onClick made a no-op): 2 failed (desktop + 375px project-dialog tests), 18 passed; wiring restored.
`npx vitest run tests/unit` — failing files diffed against baseline-failing-files.txt: zero new failing files (the run has pre-existing baseline failures, 140 failed tests, all in baseline files).
`npx tsc --noEmit` filtered to touched files (no errors)
`npx eslint` on touched files (0, clean)

## Decisions made
- NewProjectDialog gained optional controlled props (`open`, `onOpenChange`); when `open` is provided it renders no trigger button. Uncontrolled usage (projects page, sidebar empty state) is unchanged.
- NewMenu owns the open state and mounts the dialog as a sibling of the DropdownMenu (not inside menu content, which unmounts on close). NewMenu takes a new `workspaceId` prop, passed from app-sidebar as currentWorkspaceId. Dialog is mounted only when canCreate.
- Selecting Project does NOT call onNavigate, so the mobile Sheet stays open. Closing it would unmount NewMenu and the dialog with it. The Sheet remains behind the dialog after it closes.
- Test harness now uses the REAL NewProjectDialog (stub removed); stubs added only for the createProject and createProjectFromTemplate server actions. Old navigation test for Project replaced; Request navigation test kept separately.
- Task and Request items untouched.

## Out-of-scope work needed
- Task item still dispatches into the void on non-board/list subroutes (F029). Request item removal (F030).
- Possible UX polish: close the mobile Sheet after the dialog closes/creates.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Left Sheet open on Project click (see Decisions) rather than lifting dialog state above the Sheet.

## Notes for the next worker
Not verified: a live authenticated Next page and actual project creation (createProject is stubbed). The full-suite run was not re-run in isolation for any file since no new failing files appeared.
