# Handoff: F025 — real-375px-mobile-verification

## Status
COMPLETE

## Assertions covered
SB-009: PASS — real headless Chromium at 375px: hamburger visible, desktop aside not visible; 1280px control inverse; after clicking the hamburger the Sheet dialog shows Dashboard/My Tasks/Watching/Team/project links and the Account menu trigger.
SB-006: PASS — jsdom: guest, driving the Sheet's own Account menu trigger (scoped within the dialog, not [0]), menu shows Sign out but none of Templates/Archive/Trash/Settings/Preview as client; non-guest control shows all five; guest Sheet nav tree has no Team/Members/Settings/Approvals/Requests links (control: non-guest has Team).

## Files changed
tests/unit/f025-sb009-real-375px.test.ts (new)
tests/unit/f025-sb006-mobile-sheet-guest.test.tsx (new)
missions/20260921-212654/handoffs/F025-handoff.md

## Commands run
`npx vitest run tests/unit/f025-sb006-mobile-sheet-guest.test.tsx` (0, 3 tests)
`npx vitest run tests/unit/f025-sb009-real-375px.test.ts` (0, 4 tests)
Mutation: removed `md:flex` from the desktop aside, re-ran the real-375px file: the 1280px control failed; reverted (app-sidebar.tsx unchanged, git shows no diff)
`npx vitest run tests/unit` (exit non-zero; failing-file set compared to baseline, see below)
`npx tsc --noEmit | grep f025` (no errors in touched files)
`npx eslint tests/unit/f025-*` (0)

## Decisions made
- Went beyond F022's static-markup approach: the real AppSidebar is bundled with esbuild, mounted with React in Chromium, and styled with the real globals.css (PostCSS + Tailwind), so the Sheet genuinely opens and `md:` gating is evaluated by the browser.
- Sheet link heights are measured with getBoundingClientRect inside the open dialog container (>= 44px for Dashboard/My Tasks/Team), with no forced-visible aside.
- Stubbed (not under test): next/navigation, next/link, next-themes, sonner, notification bell, membership provider, server actions, NewProjectDialog, ProjectFavoriteButton.
- Baseline diff: after normalising whitespace and line:col suffixes, failing set = baseline minus tests/unit/f041-final-gate.test.tsx (known flaky, passed). No new failing files (46 vs 47).

## Out-of-scope work needed
- None.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Used esbuild (already in node_modules via vite) for the browser bundle rather than a dev server, since playwright.config.ts's webServer needs real Supabase auth.

## Notes for the next worker
- NOT verified: a live authenticated Next.js page (real routing, real data, real server actions), and the guest role in real Chromium (guest filtering is covered in jsdom only). The account-menu dropdown was not opened in Chromium.
- Only 3 nav links with text matching dashboard/team/my tasks are height-measured in the Sheet; other rows (project list) are not.
