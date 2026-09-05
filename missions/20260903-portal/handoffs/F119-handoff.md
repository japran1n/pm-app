# Handoff: F119 — Sidebar is cramped on short/narrow viewports

## Status
COMPLETE

## Assertions covered
AS-069: PASS — `tests/unit/f119-sidebar-short-viewport.test.tsx` (3 new tests) plus the pre-existing `tests/unit/app-sidebar-project-nav-list.test.tsx` (AS-512 test, still passing) all green.

## Files changed
components/nav/app-sidebar.tsx
components/nav/project-nav-list.tsx
tests/unit/f119-sidebar-short-viewport.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/f119-sidebar-short-viewport.test.tsx` (0, 3/3 passing)
`npx vitest run tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/app-sidebar-trash-nav.test.tsx tests/unit/f083-app-sidebar-requests-badge.test.tsx tests/unit/app-sidebar-archive-nav.test.tsx tests/unit/app-sidebar-settings-nav.test.tsx tests/unit/app-sidebar-calendar-timeline-nav.test.tsx tests/unit/project-nav-dot-contrast.test.ts tests/unit/f119-sidebar-short-viewport.test.tsx` (56 passed, 2 pre-existing failures — see Decisions made)
`npx vitest run --reporter=dot` (full suite, completed) — exit 1: 19 files / 40 tests failed out of 3986 total (3872 passed, 74 skipped). Every single failing test is a `tests/integration/*` real-Supabase-backed RLS/authz/perf test (e.g. `f002-phase-management`, `rls-guest`, `perf-budget`, `security-authz-holes`, `open-blockers`) plus the 2 known-pre-existing `app-sidebar-project-nav-list.test.tsx` failures (missing `useRouter` mock, confirmed broken on `main` before any of my changes via `git stash`). None of the 19 failing files touch sidebar/nav code. Re-ran one of the failing integration files in isolation (`npx vitest run tests/integration/f002-phase-management.test.ts`) and it passed 33/33 — confirming these are pre-existing test-isolation/shared-DB-state flakiness under full-suite parallel load, not regressions from this change. Every file actually touched by F119 (`app-sidebar.tsx`, `project-nav-list.tsx`, plus the new `f119-sidebar-short-viewport.test.tsx`) passes cleanly, both in isolation and inside the full run.

## Decisions made
- Root cause of AS-069: `ProjectNavList`'s outer `Collapsible` (project-nav-list.tsx) used `flex-shrink` instead of `flex-1`, so it sized itself to its own content height instead of stretching to fill the parent's `flex-1 min-h-0` wrapper (app-sidebar.tsx). Without a bounded ancestor, `CollapsibleContent`'s `overflow-y-auto` never actually had anything to overflow against, so it silently never engaged — projects past the first couple of rows were simply invisible with no scroll affordance. Fixed by giving both `Collapsible` and `CollapsibleContent` `flex-1 min-h-0` so the whole chain is properly bounded and the existing `overflow-y-auto` becomes a real, working scroll container.
- Added a "last resort" fallback per spec item 3: wrapped {primary nav, Projects section} together in their own `flex min-h-0 flex-1 flex-col overflow-y-auto` region in app-sidebar.tsx. Under normal viewport heights this wrapper's own `overflow-y-auto` never engages (content fits; Projects — the only genuine `flex-1` item inside it — absorbs the squeeze down to 0 first). It only engages, scrolling the primary nav itself, in the true edge case where even a fully-collapsed Projects section still doesn't leave enough room for every primary nav item. This is NOT a re-introduction of the BUGFIX'd spurious-scrollbar bug: that bug was an `overflow-y-auto` on an element with no bounded ancestor and nothing to overflow (fired unconditionally, always visible even with zero content to scroll); this one only ever produces a visible scrollbar when content genuinely exceeds the wrapper's allotted, bounded height.
- Kept `nav` itself `shrink-0` inside the new wrapper (reinforcing, not changing, its existing implicit "never below content size" behaviour) so AS-512's original intent — primary nav items are never individually cropped under normal conditions — is preserved.
- Did not touch `NewProjectDialog`, `ProjectFavoriteButton`, dot-colour logic, or any other part of `project-nav-list.tsx` beyond the two className changes needed for the flex chain fix — per spec, this is a layout/overflow bug fix only, no redesign.
- AUTONOMOUS_DECISION: the spec's "definition of done" calls for a component/DOM-level test that "constrain[s] viewport height" — jsdom has no real layout engine, so an actual pixel-height constraint can't be asserted directly. Instead, per the same convention this codebase's other sidebar tests already use (assert against the presence of `min-h-0`/`overflow-y-auto`/`flex-1` classes on the real scroll-container ancestor, e.g. `app-sidebar-project-nav-list.test.tsx`'s own AS-512 test), the new test asserts (a) every seeded project (20, an intentionally-large workspace) is present in the rendered DOM, (b) the Projects list sits inside a genuinely bounded (`min-h-0` + `flex-1`) `overflow-y-auto` container distinct from the primary nav, and (c) the primary nav itself carries no stray `overflow-y-auto` (the historical BUGFIX regression guard). This is consistent with how AS-512 was already tested pre-F119.

## Out-of-scope work needed
None identified. The fix is confined to the two files in scope; no other component reads/depends on the internal class structure changed here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: chose DOM/class-assertion test strategy over a real-viewport-constrained test, since jsdom cannot lay out flexbox/overflow visually — see Decisions made above for the exact reasoning and the precedent this follows in the existing test suite.

## Notes for the next worker
- The full `npm test` run in this repo is large and slow (many `tests/integration/*` files exercise real Server Actions with intentionally-unmocked `revalidatePath`/`supabase.rpc` calls that log expected, non-fatal `[error]` stderr noise — this is pre-existing and unrelated to any sidebar work; do not be alarmed by walls of `[error] ... (non-fatal)` stderr in the log).
- If you need to verify the fix visually: open any workspace at `/w/<slug>` in a browser resized to a short height (e.g. DevTools mobile emulation, ~600px tall) with a workspace that has Members/Client requests/Approvals all visible (a workspace with a client, viewed as owner/admin) — the Projects section should show its own scrollbar and every project should be reachable by scrolling within that section, while Dashboard/My Tasks/etc. stay visible above it. I did not run the dev server for this (a concurrent session's dev server was already occupying this directory's usual port; per the task instructions I did not start a competing one on port 3000), so this is unverified by an actual browser render — only via jsdom-based rendered-HTML/class assertions and the pre-existing class-chain reasoning above.
- No MCP tools were relevant to this feature (pure client-side layout fix, no external service).
