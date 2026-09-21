# Handoff: F037 — mac-detection-and-palette-fallback

## Status
COMPLETE

## Assertions covered
SB-031: PASS — sidebar hint and help dialog agree under stubbed platforms (userAgentData mac, iPod, linux); dev warn on unacknowledged fallback; mounted palette does not warn/navigate
SB-032: PASS — existing f008 single-dialog tests still pass; ack-after-setOpen ordering asserted

## Files changed
components/nav/app-sidebar.tsx
components/command/command-palette.tsx
tests/unit/f037-sb031-mac-detection-palette-fallback.test.ts
missions/20260921-212654/handoffs/F037-handoff.md

## Commands run
`npx vitest run tests/unit/f037-sb031` (0, 6 passed)
`npx vitest run tests/unit` (1; 46 failed files, all in baseline-failing-files.txt, none new; comm diff empty)
`npx tsc --noEmit` (0)
`npx eslint <touched files>` (0 after removing an unused import)

## Decisions made
- Sidebar now uses isMacPlatform() from lib/hooks/use-shortcut; identical to the help dialog detector.
- Dev warn fires whenever the event is unacknowledged and NODE_ENV==="development" (sidebar cannot know whether a palette is mounted; unacknowledged == not mounted or broken).
- Palette calls setOpen(true) before detail.handled = true.
- Mutation-verified: old regex reinstated -> userAgentData and iPod tests fail; warn removed -> warn test fails; ack moved before setOpen -> order test fails.
- Extra (1280 desktop cap): existing f007 desktop test already fails for `md:max-w-[160px]` and `md:max-w-[120px]` (verified by mutation, reverted). `max-w-[170px]` does NOT fail at 1280 because the desktop trigger column is about 170px wide, so that cap is not a regression there (it does fail at 375px, 170 vs 179). No new test added.

## Out-of-scope work needed
- The throwing-setOpen case is only covered by a source-order assertion (a React state setter cannot be made to throw from a browser test cheaply).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: skipped a new 1280 cap test, since the existing one already bites on any cap below the column width.

## Notes for the next worker
Full-suite baseline diff: none new. Flaky files (f041-final-gate etc.) did not surface as new failures this run. Verified in real Chromium with the real AppSidebar, CommandPalette and ShortcutHelpDialog; not verified against a live Next page.
