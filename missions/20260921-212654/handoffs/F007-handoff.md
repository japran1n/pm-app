# Handoff: F007 — Workspace switcher full width

## Status
COMPLETE

## Assertions covered
SB-030: PASS — real Chromium, 40-char name, desktop 1280px aside and 375px mobile Sheet: no ellipsis, no clipping, trigger fills its column, title = full name. Both tests verified to FAIL against the pre-fix component (ellipsis) and pass with the fix.

## Files changed
components/workspace-switcher.tsx
tests/unit/f007-sb030-switcher-width.test.ts
missions/20260921-212654/handoffs/F007-handoff.md

## Commands run
`npx vitest run tests/unit/f007-sb030-switcher-width.test.ts` (0; 1 with original component, as expected)
`npx vitest run tests/unit` (only diff vs baseline: f041-final-gate passed this run; no new failing files)
`npx tsc --noEmit` (no errors in touched files)
`npx eslint` on touched files (0)
`npm test` equivalent = unit scope above

## Decisions made
- The switcher lives in components/workspace-switcher.tsx (used by app-sidebar via the same component in both desktop aside and mobile Sheet), so app-sidebar.tsx was not touched.
- Removed max-w-56 (the real cause of not spanning the sidebar), replaced truncate with break-words, made the button h-auto min-h-[34px] whitespace-normal text-left so wrapping grows the button; title attr holds full name.
- Test reuses the F025 esbuild+Tailwind+real-Chromium pipeline, measuring computed text-overflow, scroll vs client size, range rects inside the span, and button vs column width.

## Out-of-scope work needed
- WorkspaceSwitcherSkeleton (components/nav/figures/skeletons.tsx) is unchanged; a long name may shift height slightly when it streams in.
- Dropdown items still use `truncate` for names inside the menu list (not part of SB-030).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: The bell sits beside the switcher in the header row, so "full width" means filling the column left of the bell, not under it.

## Notes for the next worker
Not verified: live authenticated Next page (stubbed bell, actions, membership); the real streamed workspaceSwitcherSlot path (figure wraps the same component).
