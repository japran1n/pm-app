# Handoff: F335 — regression guard for AS-517 (M17 scrutiny BLOCKER-4)

## Status
COMPLETE

## Assertions covered
AS-517: PASS — `npx playwright test tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts` (2 tests, both passed, ~2.7min) against a real Chromium browser at 375x812 across 14 primary workspace routes (dashboard, projects, board, list, my-tasks, calendar, timeline, search, trash, archive, templates, settings, settings/members, settings/audit) plus a mobile-nav-open state.

## Files changed
tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts (new)

## Commands run
`npx playwright test tests/e2e/theme-toggle.spec.ts --reporter=line` (0, 6 passed) — pre-check: verified the "authenticated Playwright specs all fail in the login helper" note in NEXT-SESSION.md is now stale
`npx playwright test tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts --reporter=line` (0, 2 passed)
`npx tsc --noEmit` (0)
`npx eslint tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts` (0)
`npx eslint .` (0 errors, 6 pre-existing unrelated warnings in lib/queries/search.ts and two unrelated test files)
`npx vitest run tests/unit` (0; 163 files / 1248 tests passed — one unrelated unhandled-error log from tests/unit/user-avatar.test.tsx's pre-existing `cookies()`-outside-request-scope effect noise, not a test failure and not touched by this feature)
`npx next build` (0, compiled + typechecked + all routes generated)

## Decisions made
- **Chose a real Playwright spec, not a jsdom/static fallback.** The task instructions said to try one existing authenticated Playwright spec first and only fall back to jsdom if it's still broken. `tests/e2e/theme-toggle.spec.ts`'s authenticated describe block (magic-link-then-cookie-injection login helper, same technique `board-reorder.spec.ts` established) passed cleanly (6/6) against the current app. The `NEXT-SESSION.md` note that "authenticated specs all fail in the login helper" is stale as of this session — so this ships the ideal fix from the mission instructions: a real Playwright spec at 375x812 asserting `document.documentElement.scrollWidth <= window.innerWidth` on real rendered pages, not a static/grep-based proxy.
- **No explicit allowlist for deliberately-scrollable containers was needed.** The assertion is about `document.documentElement` (the outermost scroller), not about any inner `overflow-x-auto` wrapper. A correctly-wrapped interior scroller (board columns, timeline rows, wide tables) never grows the document root's `scrollWidth` in the first place — that's the entire point of `overflow-x-auto` on an ancestor with a bounded width. So the test doesn't need to special-case the board/timeline/table internals: it fails exactly when one of those wrappers stops doing its job and the interior content spills into the page's own horizontal extent.
- **Seeded real content (long titles, due dates), not empty views.** An empty board/list/calendar/timeline would trivially pass and prove nothing about card/row/chip wrapping — matches the scrutiny finding's own framing ("very likely correct, but unverified").
- **Owner role, not member,** for the seeded user so settings/members and settings/audit render their real content instead of an access-denied screen — those routes were explicitly named in BLOCKER-4's route list.
- **Dismissed the F253 onboarding-tour overlay once, right after login**, via its own "Skip" button, before iterating routes. It's an unrelated fixed-position modal (not part of AS-517) that would otherwise re-render on every route navigation; on the first run of this spec (before the dismiss was added) that overlay's own hydration-recovery cost pushed total spec runtime past a 120s test timeout. Bumped `test.setTimeout` to 180_000 for the multi-route test as well, since visiting 14 real authenticated routes serially is inherently slower than any single-route spec in this suite.
- **Reused the workspace/project/task seeding + magic-link cookie-injection pattern verbatim** from `tests/e2e/board-reorder.spec.ts` / `tests/e2e/f235-calendar-responsive.spec.ts` (same `tasks` table columns: `status`, `priority`, `author_id`, `number` — not `status_id`/`created_by`, which don't exist on this schema; caught via a first failed run and corrected against the working precedent in `f235-calendar-responsive.spec.ts`).

## Out-of-scope work needed
None identified beyond BLOCKER-4 itself. The scrutiny file's Majors (MAJ-1 through MAJ-6) are separate, already-filed issues unrelated to AS-517/F266 and out of this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the real-Playwright path rather than the jsdom fallback, per the task's own instruction to verify the login helper's status first rather than assume the NEXT-SESSION.md note is still accurate — it wasn't.
AUTONOMOUS_DECISION: Did not add an explicit allowlist mechanism for scrollable containers (e.g. a data-attribute or class-based exception list) since the chosen assertion (`document.documentElement.scrollWidth <= innerWidth`) is structurally immune to false positives from correctly-implemented inner scrollers — adding an allowlist would have been unused complexity.

## Notes for the next worker
- The theme-toggle spec's authenticated block is a good reference for the current login helper mechanics if you need it again; this file's `login()` helper is copied from it near-verbatim (minus the redundant screenshot/keyboard-interaction assertions, which aren't relevant here).
- If a future route is added to the primary workspace nav, add it to the `routes` array in `tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts` — the array is intentionally flat and easy to extend.
- No MCP tools were used for this feature (pure test-authoring against Playwright + a live Supabase project via the standard admin-client SDK pattern already established in this test suite, not via MCP).
- Pre-existing repo working-tree state (other in-flight feature diffs: `app/api/extension/attachments/route.ts`, `components/nav/project-nav-list.tsx`, `lib/attachments/`, various handoffs for F257-F267/F333/F334, `missions/.../milestones/M17-scrutiny.md`) was present before this worker started and was left untouched — this worker's commit (`8982b10`) touches only the new spec file.
