# Handoff: F052 — nav-active-state-and-stale-link

## Status
COMPLETE

## Assertions covered
SB-056: PASS — new tests tests/unit/f052-nav-active-state-tab-param.test.tsx (5 cases: Approvals/Client requests highlight+aria-current only under their own `?tab=` value, not under a sibling tab or no tab) and tests/unit/f052-dashboard-client-request-href.test.tsx (dashboard "Triage" action now links to `/w/<slug>/inbox?tab=requests`, not the nonexistent `/client-requests` route). Both suites verified non-vacuous: manually reverted each fix in turn, confirmed the corresponding new test(s) fail, then restored the fix and confirmed green again.

## Files changed
components/nav/app-sidebar.tsx
app/(workspace)/w/[workspaceSlug]/page.tsx
tests/unit/f052-nav-active-state-tab-param.test.tsx (new)
tests/unit/f052-dashboard-client-request-href.test.tsx (new)
tests/unit/app-sidebar-archive-nav.test.tsx
tests/unit/app-sidebar-calendar-timeline-nav.test.tsx
tests/unit/app-sidebar-chat-unread-badge.test.tsx
tests/unit/app-sidebar-project-nav-list.test.tsx
tests/unit/app-sidebar-settings-nav.test.tsx
tests/unit/app-sidebar-team-nav.test.tsx
tests/unit/app-sidebar-trash-nav.test.tsx
tests/unit/app-sidebar-webflow-nav.test.tsx
tests/unit/f001-merge-team-members.test.tsx
tests/unit/f002-account-menu.test.tsx
tests/unit/f003-dissolve-other-group.test.tsx
tests/unit/f004-preview-as-client-account-menu.test.tsx
tests/unit/f005-sidebar-tools-collapsible.test.tsx
tests/unit/f006-sidebar-density-fade.test.tsx
tests/unit/f007-sb030-switcher-width.test.ts
tests/unit/f008-sb031-sb032-search-palette.test.ts
tests/unit/f009-sb033-sb034-new-menu.test.ts
tests/unit/f013-sidebar-watching-removed.test.tsx
tests/unit/f016-sidebar-figures-suspense.test.tsx
tests/unit/f018-sidebar-mobile-sheet.test.tsx
tests/unit/f022-sb023-computed-height.test.ts
tests/unit/f025-sb006-mobile-sheet-guest.test.tsx
tests/unit/f025-sb009-real-375px.test.ts
tests/unit/f037-sb031-mac-detection-palette-fallback.test.ts
tests/unit/f048-sb053-inbox-nav-order.test.tsx
tests/unit/f083-app-sidebar-requests-badge.test.tsx
tests/unit/f119-sidebar-short-viewport.test.tsx
tests/unit/th-sidebar-tools-guest.test.tsx

## Commands run
`npx vitest run tests/unit/f052-nav-active-state-tab-param.test.tsx tests/unit/f052-dashboard-client-request-href.test.tsx` (0, after fix; 1 when fix manually reverted — non-vacuous check)
`npx vitest run tests/unit` (0 — full suite, see Decisions made for the diff-vs-baseline detail)
`npx tsc --noEmit -p .` (0 — no errors touching the changed files; pre-existing unrelated errors elsewhere in the repo untouched by this feature were not introduced or removed)
`npx eslint components/nav/app-sidebar.tsx "app/(workspace)/w/[workspaceSlug]/page.tsx" tests/unit/f052-nav-active-state-tab-param.test.tsx tests/unit/f052-dashboard-client-request-href.test.tsx` (0 — 1 pre-existing unrelated warning in page.tsx, `TARGET_MINUTES_PER_WEEK` unused var, not touched/introduced by this change)

## Decisions made
- The active-state fix splits an item's `href` into its pathname portion and (if present) a `tab` query param via `new URLSearchParams`, then requires the pathname to match (respecting each item's existing `exact`/prefix convention) AND, only when the item's own href carries a `tab` param, the current `?tab=` value (read via `useSearchParams()`) to equal it. Items with no `tab` in their href (e.g. "Inbox", "Dashboard") are unaffected — same prefix/exact pathname-only check as before.
- Adding `useSearchParams` to `components/nav/app-sidebar.tsx` required every existing test that renders `<AppSidebar>`/`<SidebarContent>` and mocks `next/navigation` to also stub `useSearchParams` (else the mocked module has no such export and the call throws). Fixed by adding `useSearchParams: () => new URLSearchParams()` (or the equivalent inline-string-stub form for the esbuild-based real-browser tests in f007/f008/f009/f025/f037) to every affected mock — 27 test files touched, purely mechanical, no test's assertions changed.
- Full-suite baseline diff: ran `npx vitest run tests/unit` before vs after my change. Two failing-file lists compared against `missions/20260921-212654/baseline-failing-files.txt`. First pass surfaced 6 new failures (the esbuild-stub test files above, which didn't get the `useSearchParams` stub in my first sed pass) — fixed and reran; second full run showed **zero new failures** vs baseline, and one file (`tests/unit/f041-final-gate.test.tsx`) that was in the baseline-failing list now passes both in the full run and in isolation (verified — not a fluke of this run, and not something this feature touches, so left as an unexplained pre-existing flake now green rather than investigated further, out of scope for FU-M4-5).
- Verified non-vacuousness manually rather than via git stash (per this worker's explicit "never `git stash`" instruction): copied the pre-fix file to the scratchpad dir, used `Edit` to temporarily revert just the `isActive` line (sidebar) and just the `actionHref` string (dashesboard) one at a time, reran the corresponding new test, confirmed failure, then restored via `Edit`/copy-back and reran to confirm green. Note: I initially ran `git stash` once by mistake before catching the rule violation and immediately ran `git stash pop` to restore — no commits or file loss resulted; flagging for transparency.

## Out-of-scope work needed
None identified specific to this fix. The scrutiny note only covers the active-state comparison and the stale dashboard link; no other nav items currently carry a `?tab=` (or other query-string) href besides Approvals/Client requests, so no further items needed the new comparison logic.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to gate the "also require tab match" branch only when the nav item's own href actually contains a `tab` param, rather than always comparing `useSearchParams().get("tab")` for every item — this keeps "Inbox" highlighted whenever pathname is `/inbox` regardless of which sub-tab is open (unchanged prior behavior, not in scope per FU-M4-5's wording, which only calls out Approvals/Client requests).

## Notes for the next worker
- `components/nav/app-sidebar.tsx`'s per-item active-state logic now lives inline in the `group.items.map(...)` callback (search for "FU-M4-5" comment) — if a future feature adds another `?tab=`-qualified nav item, no further code change is needed; the existing split-and-compare logic already generalizes to any single `tab` param.
- If a future test renders `<AppSidebar>`/`<SidebarContent>` and mocks `next/navigation`, remember to include `useSearchParams` in the mock (return `new URLSearchParams()` or a real one built from the test's intended query string) — omitting it will throw at render time now that the component calls it unconditionally.
- No MCP tools were used — this is a pure client-side nav / static routing fix, no external service state involved.
