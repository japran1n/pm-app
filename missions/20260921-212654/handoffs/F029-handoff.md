# Handoff: F029 — new-task-no-silent-noop

## Status
COMPLETE

## Assertions covered
SB-033: PASS — "+ New -> Task" on board/list opens the real NewTaskDialog; on the other project subroutes it navigates to the board (no silent no-op). Desktop and 375px Sheet.

## Files changed
components/nav/new-menu.tsx
components/task/new-task-dialog.tsx
lib/hooks/use-shortcut.ts
tests/unit/f009-sb033-sb034-new-menu.test.ts
missions/20260921-212654/handoffs/F029-handoff.md

## Commands run
`npx vitest run tests/unit/f009-sb033-sb034-new-menu.test.ts` (0, 32 passed)
Same file with the fix removed from new-menu.tsx (temporarily, restored) (1, 10 subroute tests failed on desktop and 375px)
`npx tsc --noEmit` filtered to touched files (no errors in them)
`npx eslint` on the 4 touched code files (0 problems)
`npx vitest run tests/unit` (known baseline failures; diffed failing files vs baseline-failing-files.txt: no new failing files)

## Decisions made
- Chose the acknowledgement handshake (as with command-palette:open): NewTaskShortcutDetail gets optional `handled`; NewTaskDialog's listener sets `detail.handled = true` synchronously when it opens. Backwards compatible with the `n` shortcut.
- Fallback when unhandled: router.push to `/w/<slug>/projects/<id>/board` (the route that hosts the dialog). It does not auto-open the dialog after navigation, since no cross-navigation handoff exists; the user lands on the board with the New Task button.
- Sheet closes (onNavigate) only after handled or when navigating.
- Test harness mounts the real NewTaskDialog only when the stubbed path is /w/acme/projects/p-42/(board|list), mirroring how the app mounts it. Stubbed: server actions tasks/phases/task-types.

## Out-of-scope work needed
- Optionally auto-open the dialog after the fallback navigation (e.g. a ?new=task param on the board). Not done.
- The harness's "dialog is mounted only on board/list" is an assumption taken from the scrutiny finding; not verified by a filesystem check of the pages.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: handshake plus navigate-to-board fallback, rather than narrowing the path regex, so any future route that mounts the dialog works without touching new-menu.

## Notes for the next worker
Request item untouched (F030). Not verified: a live authenticated Next page; a real board page's dialog mount.
