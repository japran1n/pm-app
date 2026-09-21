# Handoff: F006 — Denser spacing + bottom fade

## Status
COMPLETE

## Assertions covered
SB-023: PASS — nav links carry md:h-8 with max-md:min-h-11 (class-level test; jsdom has no layout)
SB-024: PASS — fade shown only when overflowing and not at bottom; hidden otherwise (scroll events with mocked dimensions)
SB-008: PASS — no hex/forbidden classes in touched files
SB-009: PASS — mobile Sheet still uses the same SidebarContent (menu trigger present; markup shared)

## Files changed
components/nav/app-sidebar.tsx
components/nav/project-nav-list.tsx
tests/unit/f006-sidebar-density-fade.test.tsx

## Commands run
`npx vitest run tests/unit/f006-sidebar-density-fade.test.tsx` (0)
`npx vitest run tests/unit --exclude '.claude/**'` (1; 141 failing tests in pre-existing network/integration-style files, none in sidebar/nav files)
`npx vitest run` sidebar-related files (only failures are stale copies under .claude/worktrees)
`npx tsc --noEmit` filtered to components/nav and f006 test (no errors)
`npx eslint` on touched files (0)

## Decisions made
- Fade is a sibling of the scroll container inside a new relative wrapper, so it stays pinned at the bottom instead of scrolling with content.
- Fade state is driven by scroll events plus a ResizeObserver, guarded for environments without ResizeObserver.
- Uses bg-gradient-to-t from-sidebar to-transparent (derived token, no hex).
- Group gap gap-3 -> gap-2 and label top margin mt-3 -> mt-2, in both files.
- Item height: md:h-8 md:py-0, with max-md:min-h-11 kept.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: no browser check of computed 32px height; asserted via classes because jsdom has no layout.

## Notes for the next worker
Full-suite failures are pre-existing and unrelated to sidebar; stale .claude/worktrees copies of sidebar tests fail and were ignored.
