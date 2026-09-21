# Handoff: F008 — Search button + ⌘K

## Status
COMPLETE

## Assertions covered
SB-031: PASS — sidebar Search button shows mono hint (Ctrl K / ⌘K on Mac platform), click opens the real CommandPalette; verified in real Chromium at 1280px and in the 375px mobile Sheet; falls back to /w/<slug>/search when no palette is mounted.
SB-032: PASS — Ctrl+K / Meta+K opens exactly one cmdk dialog; second press closes; button-then-shortcut toggles closed (single listener, single dialog).

## Files changed
components/nav/app-sidebar.tsx
components/command/command-palette.tsx
tests/unit/f008-sb031-sb032-search-palette.test.ts
missions/20260921-212654/handoffs/F008-handoff.md

## Commands run
`npx vitest run tests/unit/f008-sb031-sb032-search-palette.test.ts` (0) 7/7
`npx vitest run tests/unit` (1) 50 failed files; diff vs baseline below
`npx tsc --noEmit` (0)
`npx eslint` on the 3 touched files (0)
Mutation checks: removing the palette open-event handler fails 3 tests (SB-031 desktop, SB-031 375px, SB-032 button-then-shortcut); adding a duplicate keydown registration fails 1 (button-then-shortcut).

## Decisions made
- Palette exports COMMAND_PALETTE_OPEN_EVENT ("command-palette:open") and listens on window; the sidebar dispatches it with detail {handled:false}, the palette flips it to true synchronously. If unhandled, sidebar does router.push(`/w/<slug>/search`). No new keydown listener added; the existing single Cmd+K toggle in the palette is untouched.
- Did not reuse SHORTCUT_EVENTS.openSearch: HeaderSearch also listens to it and would steal focus. The sidebar uses the event string literal (importing the palette into the sidebar would pull server actions into it); touching lib/hooks was out of scope.
- Hint resolves after mount (default "Ctrl K", upgraded to "⌘K" on mac/iOS platform) to avoid hydration mismatch. kbd is font-mono.
- Button sits above the nav, outside filterGuest and role gates; palette guest gating is unchanged. onNavigate is called so the mobile Sheet closes on click.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: separate `command-palette:open` event rather than reusing the "/" shortcut event (see Decisions).

## Notes for the next worker
- Baseline diff (npx vitest run tests/unit): f041-final-gate now passes (known flaky). Four files newly failed in the full run only: f055-portal-questionnaire, f056-questionnaire-progress, f060-required-validation, f061-submit. They pass 18/18 in isolation, do not touch sidebar/palette; load flakiness, not caused by this change.
- Verified: real Chromium, real AppSidebar + real CommandPalette; stubbed next/navigation, server actions (palette-search), realtime hook, membership. Not verified: a live authenticated Next page; mac glyph tested by overriding navigator.platform (headless on a mac host reports MacIntel, so the test pins Linux for the Ctrl case). The duplicate-listener mutation is caught by only one test because React batches double toggles.
- kbd font assertion injects --font-source-code-pro since next/font is not loaded in the harness.
