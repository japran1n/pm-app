# Handoff: F009 — + New menu

## Status
COMPLETE

## Assertions covered
SB-033: PASS — "+ New" menu lists Task, Project, Request; each reaches the existing create surface (see Decisions). Verified in real Chromium at 1280px (aside) and 375px (mobile Sheet).
SB-034: PASS — guests (isGuest true AND canManage true, and guest flag with member role) get no button; viewer gets no button; member gets Task+Project only; admin in a workspace without a client gets no Request. Desktop and Sheet.

## Files changed
components/nav/new-menu.tsx (new)
components/nav/app-sidebar.tsx
tests/unit/f009-sb033-sb034-new-menu.test.ts
missions/20260921-212654/handoffs/F009-handoff.md

## Commands run
`npx vitest run tests/unit/f009-sb033-sb034-new-menu.test.ts` (0) 18/18
`npx vitest run tests/unit` (1) 46 failed files; `comm` vs baseline-failing-files.txt: zero newly failing files
`npx tsc --noEmit` (0)
`npx eslint` on the 3 touched files (0)
Mutation checks: removing the `!isGuest` gate fails 4 SB-034 tests (both guest tests, desktop+Sheet); forcing canRequest=true fails 8 SB-034 tests (member, viewer, no-client, guest, both surfaces).

## Decisions made
- No existing create flow exposes a controlled entry point (NewTaskDialog/NewProjectDialog own their trigger and open state; editing them is outside Touches). So:
  - Task: on a /projects/<id> route, dispatches the existing SHORTCUT_EVENTS.newTask event (same as the `n` shortcut), which opens that project's real NewTaskDialog. Elsewhere navigates to /w/<slug>/projects, because a task needs a project.
  - Project: navigates to /w/<slug>/projects (hosts NewProjectDialog).
  - Request: navigates to /w/<slug>/requests. Clients create requests in the portal; staff have no create form, so this is the team-side request surface.
- Gating: Task/Project require !isGuest and canWrite(membership.role) (matches createProject server checks; null membership treated as permissive, same convention as NewTaskDialog). Request requires !isGuest && canManageWorkspace && hasClient (same as the Client requests nav item). No entries left -> component returns null.
- Button sits above Search in the sidebar top block, outside filterGuest; uses existing DropdownMenu, onNavigate closes the Sheet.

## Out-of-scope work needed
- If a true "open create dialog in place" from anywhere is wanted, NewProjectDialog and NewTaskDialog need a controlled `open` prop or a window event (NewProjectDialog has none; NewTaskDialog only listens for a project-scoped event). Project/Task-off-project currently land on the Projects page and the user clicks its button.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Request entry routes to the Client requests inbox since no staff-side request create form exists.

## Notes for the next worker
- Verified: real AppSidebar + real NewMenu + real base-ui DropdownMenu in Chromium; membership, next/navigation and server actions are stubbed. Task event asserted by listening on window, the real NewTaskDialog is not mounted in the harness. Not verified: a live authenticated Next page.
- Not covered: the pushed routes are asserted, not that those pages render.
