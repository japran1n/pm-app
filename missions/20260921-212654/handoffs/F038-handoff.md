# Handoff: F038 — switcher-full-width-40char-fully-visible

## Status
COMPLETE

## Assertions covered
SB-030: PASS — real-Chromium tests at 1440, 1280 and 375px (Sheet), for spaced, no-space and all-caps short-word 40-char names: trigger width == aside width - 24 (+-1px), no clipped lines, height <= 130px. The 9 width tests FAIL against the old code (verified by temporarily restoring HEAD versions of the two source files, then restoring my changes).

## Files changed
components/nav/app-sidebar.tsx
components/workspace-switcher.tsx
components/nav/figures/skeletons.tsx
tests/unit/f007-sb030-switcher-width.test.ts
tests/unit/f036-switcher-skeleton-footprint.test.ts

## Commands run
`npx vitest run tests/unit/f007-sb030-switcher-width.test.ts tests/unit/f036-switcher-skeleton-footprint.test.ts` (0, 12 passed)
Same f007 test against HEAD sources (1, 9 failed, as required)
`npx vitest run tests/unit` (1; 46 failed files, every one in baseline-failing-files.txt, diff empty)
`npx tsc --noEmit` (0, no output)
`npx eslint` on touched files (0)

## Decisions made
- Bell moved out of the header row into the Search row (Search flex-1 + bell). The NotificationBell/slot is still mounted in the same sidebar, so badge and realtime side effects are unchanged. Not deleted (F014 will handle it). The mobile top-bar bell is separate and untouched.
- Label clamp raised line-clamp-4 -> line-clamp-6 (documented ceiling 130px trigger); break-words was already present.
- Skeleton unchanged in size (34px, w-full); f036 harness row updated to the new bell-less header markup; skeleton short-name footprint test still passes within 1px.
- The f007 test uses a bell stub with the real bell's measured 38px box (aria-label Notifications) and asserts the bell is not in the header row but is visible inside the aside.

## Out-of-scope work needed
- Live authenticated check not done.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: chose a 6-line ceiling; a 40-char name needs 3 lines at 240px.

## Notes for the next worker
Verified in the Chromium harness only (real AppSidebar, real CSS, stubbed bell/next). Not verified live against `npm run dev`; no workspace was renamed. Search + bell fit at 240px (test_SB_030_search_and_new_controls_still_fit_at_240px). The 256px Sheet case is covered by the 375px tests.
