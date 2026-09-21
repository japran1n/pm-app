# Handoff: F019 — theme-toggle-resolvedtheme

## Status
COMPLETE

## Assertions covered
SB-014: PASS — unmocked test in real next-themes ThemeProvider (system default) asserts html class + data-theme flip on first click and localStorage "theme" persistence/remount; verified the test fails with the old `theme` logic.

## Files changed
components/nav/account-menu.tsx
components/ui/theme-toggle.tsx
tests/unit/f019-theme-toggle.test.tsx
tests/unit/f002-account-menu.test.tsx
missions/20260921-212654/handoffs/F019-handoff.md

## Commands run
`npx vitest run tests/unit/f019-theme-toggle.test.tsx` (0, 3 pass)
`npx vitest run tests/unit` (failing files diffed vs baseline)
`npx tsc --noEmit | grep touched files` (no errors in touched files)
`npx eslint <touched files>` (0)

## Decisions made
- Both components now use `resolvedTheme` for setTheme target and isDark.
- Removed the mocked SB-014 test from f002-account-menu.test.tsx (its file-wide next-themes mock cannot coexist with a real provider); replaced by tests/unit/f019-theme-toggle.test.tsx.
- Test installs an in-memory localStorage because jsdom here exposes none.
- Baseline diff: 46 failing files now vs 47 baseline; no new failures. Only difference: tests/unit/f041-final-gate.test.tsx no longer fails (unrelated; likely flaky).

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Removed old mocked SB-014 test rather than keeping both.

## Notes for the next worker
Icon in ThemeToggle uses CSS dark: classes, unaffected.
