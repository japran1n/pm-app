# Handoff: F032 — share-palette-event-constant

## Status
COMPLETE

## Assertions covered
SB-031: PASS — sidebar Search button (desktop and 375px Sheet) dispatches the shared constant's event; the mounted palette answers it and opens; F008 tests still pass (12/12).

## Files changed
lib/hooks/use-shortcut.ts
components/command/command-palette.tsx
components/nav/app-sidebar.tsx
tests/unit/f008-sb031-sb032-search-palette.test.ts
tests/unit/f032-palette-event-constant.test.tsx
missions/20260921-212654/handoffs/F032-handoff.md

## Commands run
`npx vitest run tests/unit/f032-palette-event-constant.test.tsx tests/unit/f008-sb031-sb032-search-palette.test.ts` (0) 17 passed
`npx tsc --noEmit` (0)
`npx eslint <touched files>` (0, no output)
`npx vitest run tests/unit` (non-zero, 46 failed files / 140 tests) — diffed failing files against baseline-failing-files.txt: zero new failing files, so no isolation re-runs were required.
Mutation checks (reverted after): sidebar dispatching a different literal -> 5 Chromium tests failed (incl. both new ones); removing the palette's two removeEventListener calls -> both unmount tests failed.

## Decisions made
- COMMAND_PALETTE_OPEN_EVENT moved to lib/hooks/use-shortcut.ts (client-safe, no server actions, alongside SHORTCUT_EVENTS); both sides import it. It had no other importers, so the old export was removed rather than re-exported.
- New Chromium tests register the listener with the constant's value with no palette mounted, so only the sidebar's dispatch is observed (desktop and 375px Sheet).
- jsdom test mounts the real CommandPalette (mocking only server action, realtime hook, membership, router; stubbing ResizeObserver/scrollIntoView for cmdk) to cover open-on-event and unmount listener removal (document keydown and window open event).
- A source-text test guards against the literal returning and against server-action imports in the shared module.

## Out-of-scope work needed
None. The 46 baseline-failing unit files are pre-existing and untouched.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Did not keep a re-export in command-palette.tsx since nothing imported it.

## Notes for the next worker
Verified: unit tests (jsdom and real Chromium via bundled AppSidebar) plus tsc/eslint. Not verified: a live authenticated Next page.
