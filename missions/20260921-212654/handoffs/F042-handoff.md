# Handoff: F042 — hydration-safe-recents-drag-fix

## Status
COMPLETE

## Assertions covered
SB-041: PASS — `test_SB_041_drag_persists_visual_drop_position` in tests/unit/f042-recents-hydration-drag.test.tsx captures the real `onDragEnd` handler (via the repo's existing `@dnd-kit/core` DndContext-mock convention, see f024-drag-cancellation.test.tsx) and asserts `reorderProject`'s `newPosition` is computed against the `sidebar_position` order, not the recency-sorted view. Verified non-vacuous: fails (`newPosition` 0 instead of 2) when `otherIds` is reverted to source from `otherProjects`.
SB-042: PASS — `test_SB_042_recents_read_is_hydration_safe` performs a real `react-dom/server` `renderToString` pass with no `window.localStorage` (simulating true SSR), then `hydrateRoot`s that markup on a client that DOES have recents in localStorage, asserting zero `onRecoverableError` hydration-mismatch callbacks. Verified non-vacuous: fails with a real "Hydration failed because the server rendered HTML didn't match the client" recoverable error when `recentIds` is reverted to the `useState(() => readRecentProjectIds())` lazy initializer.

## Files changed
components/nav/project-nav-list.tsx
tests/unit/f042-recents-hydration-drag.test.tsx

## Commands run
`npx vitest run tests/unit/f042-recents-hydration-drag.test.tsx` (0)
`npx vitest run tests/unit/f042-recents-hydration-drag.test.tsx tests/unit/project-nav-list-sidebar-position.test.tsx tests/unit/f011-project-nav-section.test.tsx tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/project-nav-list-icon.test.tsx` (0)
`npx vitest run tests/unit` (exit 1 — 46 files fail, all pre-existing per baseline diff below; no test in this feature's own file failed)
`npx tsc --noEmit -p .` (checked touched-file-scoped errors only; two TS errors introduced by my first draft test file were fixed — see Decisions made; final run shows zero errors referencing `project-nav-list.tsx` or `f042-recents-hydration-drag.test.tsx`)
`npx eslint components/nav/project-nav-list.tsx tests/unit/f042-recents-hydration-drag.test.tsx` (0)
`git commit` (0)

## Decisions made
- Followed the clarified FU-4 fix exactly: moved `readRecentProjectIds()` out of the `useState` lazy initializer into a post-mount `useEffect`, and changed `handleDragEnd`'s `otherIds` source from `otherProjects` (the on-screen, possibly recency-sorted/truncated view) to `allOtherProjects` (the real `sidebar_position` order), per the spec's own reasoning.
- Added `// eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration read of persisted UI state` on the new `setRecentIds` call inside the effect — this is the exact repo-established convention for "read persisted client-only state after mount" (see `components/nav/app-sidebar.tsx` lines ~341 and ~370, and `components/whats-new/whats-new-panel.tsx`), not a new pattern introduced by this feature.
- For the SB-042 test, initially wrote weaker RTL-`render()`-based tests (checking `getItem` was called, checking markup contained a seeded recent) and explicitly re-verified them against the DoD's "non-vacuous" requirement by reverting the fix — they still passed, proving they were vacuous (RTL's `render()` flushes effects synchronously inside `act()`, so it can't distinguish "read during render" from "read in an effect" this way). Replaced with a real SSR-then-hydrate test using `react-dom/server`'s `renderToString` (with `window.localStorage` temporarily deleted, mirroring an actual server which never has `window`) followed by `react-dom/client`'s `hydrateRoot` wrapped in `act()`, asserting no `onRecoverableError` hydration-mismatch callback fires. Confirmed this test fails with the real React hydration-mismatch error message when the fix is reverted, and passes with the fix in place.
- For SB-041, used this repo's existing `@dnd-kit/core` `DndContext` mock-and-capture-`onDragEnd` pattern (see `tests/unit/f024-drag-cancellation.test.tsx`) rather than attempting real pointer-drag simulation, since jsdom has no native drag/pointer capture support and this is the established convention here.
- Fixed two TypeScript errors in the test file's own mock (`vi.mock("@/lib/actions/projects", ...)` spread-argument typing) by giving the mock explicit parameter types instead of `...args: unknown[]`.

## Out-of-scope work needed
None identified beyond FU-4's scope. The broader recency/favourites sidebar logic (F011, F040, F041) was left untouched except for the two lines FU-4 specifically targets.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to write a real `renderToString` + `hydrateRoot` test for SB-042 (rather than an RTL-only test) after discovering the simpler RTL-based approach was vacuous under this repo's React 19 + RTL setup. This is a stronger, more faithful reproduction of the actual hydration-mismatch bug the spec describes and was validated to fail without the fix.

## Notes for the next worker
- jsdom in this repo's test config has no native `window.localStorage` (see the `ExperimentalWarning: localStorage is not available` line every jsdom test run logs); any new test touching localStorage needs the same in-memory polyfill this file and `tests/unit/palette-actions-recents.test.tsx` both carry (`getItem`/`setItem`/`removeItem`/`clear`, `configurable: true`).
- No MCP tools were needed for this feature — it's pure client-side component logic with no external service or Supabase-backed state involved.
