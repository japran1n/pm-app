# Handoff: F027 — switcher-containment-fix-and-test

## Status
COMPLETE

## Assertions covered
SB-030: PASS — real-Chromium test now asserts containment at 1280px and 375px Sheet; verified it FAILS on the F007 code (btn -18.6..65.6 vs row 0..48; Sheet -9.3..56.3) and PASSES after the fix.

## Files changed
components/nav/app-sidebar.tsx
components/nav/figures/skeletons.tsx
tests/unit/f007-sb030-switcher-width.test.ts
tests/unit/f017-suspense-fallback-footprint.test.tsx

## Commands run
`npx vitest run tests/unit/f007-sb030 tests/unit/f017-suspense` (0)
Same f007 test with old `h-12` temporarily restored: 2/2 FAIL with the numbers above (0 after restore -> pass)
`npx vitest run tests/unit` — 46 failing files vs 47 in baseline; zero new failing files (comm -13 empty), so no isolation re-runs were needed
`npx tsc --noEmit` — no errors in touched files
`npx eslint <4 touched files>` (0)

## Decisions made
- Chose "let the row grow": header row is now `flex min-h-12 items-center gap-2 border-b px-3 py-1.5`. Single-line names still give a 48px row (34+12 < 48); long names grow the row, pushing the control block down (no overlap). Kept items-center so the bell stays centred.
- Skeleton: dropped `max-w-56` (already removed from the real trigger in F007), kept h-[34px]. A long-name switcher still grows after streaming in; a fixed skeleton cannot know the name length. Single-line names have no jump.
- Test: added row containment (0.5px), label Range rects inside viewport, no overlap with the next sibling, and trigger width compared to the aside's inner width (upper bound aside width; lower bound aside minus px-3 padding, gap, and 44px bell allowance) replacing the vacuous colWidth check.

## Out-of-scope work needed
- Dropdown list item still uses `truncate` (workspace-switcher.tsx:87), eliding long names in the menu (minor, from scrutiny; not in F027 scope).
- Sticky `aside` (h-svh) layout with a very tall row was verified only via the sidebar's mounted DOM in Chromium (row grows, no overlap), not in a live Next page.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: chose the growing-row option over a 2-line cap so the full 40-char name stays visible (SB-030 wording).

## Notes for the next worker
Not verified: live authenticated Next page; only esbuild-bundled AppSidebar with stubs in headless Chromium (as in F007/F025). Dark theme not exercised.
