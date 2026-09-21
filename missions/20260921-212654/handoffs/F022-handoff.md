# Handoff: F022 — behavioural-tests

## Status
COMPLETE

## Assertions covered
SB-011: PASS — real Settings page rendered for owner and admin contains an <a href="/w/acme/settings/members">Members</a>; real Members page renders (h1 + "Active members"); guest is redirected.
SB-015: PASS — real signOut action with the REAL next/navigation redirect (unmocked): thrown digest matches NEXT_REDIRECT;...;/sign-in;. F002 failure-path tests tightened: after rejection / {ok:false} the menu is reopened and the Sign out item must be visible, without data-disabled / aria-disabled.
SB-023: PASS — measured in real headless Chromium: desktop nav links getBoundingClientRect().height === 32 at 1280px; >= 44 at 375px. Mutation check (md:h-8 -> md:h-9) failed the desktop test (36 != 32), then reverted.

## Files changed
tests/unit/f022-sb011-settings-members.test.tsx (new)
tests/unit/f022-sb015-signout-redirect.test.ts (new)
tests/unit/f022-sb023-computed-height.test.ts (new)
tests/unit/f001-merge-team-members.test.tsx (removed source-grep SB-011 test)
tests/unit/f006-sidebar-density-fade.test.tsx (removed class-string SB-023 test)
tests/unit/f002-account-menu.test.tsx (tightened re-enable assertion)
missions/20260921-212654/handoffs/F022-handoff.md

## Commands run
`npx vitest run tests/unit` (1; same 47 baseline failing files, see below)
`npx vitest run` on the 4 new/edited F022 files + f002 (0)
`npx tsc --noEmit` filtered to touched files (no errors in touched files)
`npx eslint` on touched files (0, no output)

## Decisions made
- SB-023: no dev server needed. The test renders the real AppSidebar to static HTML, compiles the real app/globals.css via PostCSS + @tailwindcss/postcss, loads both into Playwright chromium (library API, from vitest) and measures. Avoids the e2e webServer + real-Supabase auth requirement of playwright.config.ts.
- Old class-string / source-grep tests were removed (replaced, with pointer comments) rather than left alongside.
- Baseline diff: after normalising line:col suffixes, failing-file set = baseline minus tests/unit/f041-final-gate.test.tsx (it passes now, 4/4 in isolation). No new failing files.

## Out-of-scope work needed
- None required.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Mobile 375px measurement uses the desktop <aside> forced visible via injected `aside{display:flex !important}`, because the real mobile surface (Sheet) is not in static markup.

## Notes for the next worker
- What was NOT verified: the link inside the actual open mobile Sheet at 375px in a live app (same NavContent link classes, different container); no live dev server / authenticated page was exercised. Settings/Members pages were rendered as server components with mocked data layer (workspace context, members query, supabase client) and stubbed interactive client leaves, not against a real DB.
- Playwright chromium is installed in ~/Library/Caches/ms-playwright; launches headless reliably (~1s).
