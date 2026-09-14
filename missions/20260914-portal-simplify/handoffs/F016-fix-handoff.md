# Handoff: F016 — M2 scrutiny fix: Project group expansion by route prefix

## Status
COMPLETE

## Assertions covered
AS-016: PASS — Project group now expands on /files, /t/[taskId], and any other project-child route, not just the ones listed in buildPortalProjectNavItems; still does not expand on Home/for-you/conversation.

## Files changed
components/portal/portal-sidebar.tsx
components/portal/portal-sidebar.test.tsx

## Commands run
`npx vitest run components/portal/portal-sidebar.test.tsx` (0)
`npx tsc --noEmit -p .` (no new errors)

## Decisions made
- Detection is now `!isOnTopLevelRoute && pathname.startsWith(`${basePath}/`)` rather than trying to enumerate every possible child route -- this covers `/files`, `/t/[taskId]`, and any future route added under the project shell without needing a corresponding nav-item entry, per the task's explicit instruction.
- When the current route matches one of `buildPortalProjectNavItems`'s items, that item is still marked current via the existing `isItemActive` per-row check (unchanged). When it doesn't (e.g. `/files`, `/t/abc`), no child is marked current, but the group is still expanded -- exactly the behaviour the task asked for ("mark nearest child current if applicable, else none").

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
None beyond what's documented above.

## Notes for the next worker
No MCP usage — pure client-side component logic + tests.
