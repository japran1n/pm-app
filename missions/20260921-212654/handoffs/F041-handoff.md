# Handoff: F041 — stop-dropping-favorites-6plus

## Status
COMPLETE

## Assertions covered
SB-041: PASS — `tests/unit/f041-favorites-overflow.test.tsx` renders 8 favourites, asserts all 8 names present with exactly 5 in the pinned "Favourite projects" group. Verified non-vacuous: reverted `components/nav/project-nav-list.tsx` via `git stash` and re-ran the test — it failed (3 of 8 overflow favourites missing from the DOM), confirming it fails without the fix.

## Files changed
components/nav/project-nav-list.tsx
tests/unit/f041-favorites-overflow.test.tsx

## Commands run
`npx vitest run tests/unit/f041-favorites-overflow.test.tsx tests/unit/project-favorites-sidebar-pin.test.tsx tests/unit/f040-sidebar-recents-fallback.test.tsx tests/unit/f119-sidebar-short-viewport.test.tsx` (0, 11 passed)
`git stash push -- components/nav/project-nav-list.tsx && npx vitest run tests/unit/f041-favorites-overflow.test.tsx && git stash pop` (test failed as expected pre-fix, confirming non-vacuous; stash popped cleanly)
`npx vitest run tests/unit` (1 — 46 files / 140 tests failed, all pre-existing per baseline diff below)
`npx tsc --noEmit -p .` (ran full project; grepped output for touched files — 0 errors on both touched files after fix)
`npx eslint components/nav/project-nav-list.tsx tests/unit/f041-favorites-overflow.test.tsx` (0, clean)

## Decisions made
- Root cause: `allOtherProjects` filtered out every project whose id was in `favoriteIds` (the full set), while `favoriteProjects` (the rendered pinned group) only kept the first 5 via `selectSidebarProjects`. Any favourite past the cap of 5 was excluded from BOTH groups and never rendered.
- Fix: compute `pinnedFavoriteIds` from `favoriteProjects` (the already-capped, already-rendered set) instead of the raw `favoriteIds`. `allOtherProjects` now excludes only those pinned ids, so overflow favourites (6th+) flow into the ordinary non-favourite group — still visible, still reachable, still draggable (consistent with "the non-favourite group IS drag-reorderable" behaviour already documented in that file) — just without the pinned/starred visual treatment, matching the spec's "fall back into the non-pinned group" wording verbatim.
- No change to `selectSidebarProjects` (lib/nav/select-sidebar-projects.ts) — it's a pure, independently-tested helper and the cap-at-5 pinned behaviour it produces is correct; the bug was purely in how `project-nav-list.tsx` used its output to derive the "other" group.
- Read the CURRENT (post-F040) file before editing per instructions; F040's `isTrueEmptyRecents` / recents-fallback logic keys off `favoriteProjects.length === 0`, which is unaffected by this change (still computed the same way, still capped at 5) — confirmed via `tests/unit/f040-sidebar-recents-fallback.test.tsx` passing unchanged.
- No MCP usage — this is a pure client-rendering bug fix, no external service or live schema/state involved (mcp-registry.md not consulted for this feature; consistent with "Pure UI feature → No MCP" in worker-mcp-usage skill).

## Out-of-scope work needed
None identified beyond this fix's scope. The unrelated pre-existing failures in tests/unit/th-extraction.test.ts, tests/unit/th-preview-pane.test.tsx, etc. are baseline failures (see below) — not touched, not in scope for F041.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "overflow favourites render in the ordinary non-favourite group, draggable, without pinned styling" over an alternative like "show an overflow indicator/link" because the spec explicitly says "fall back into the non-pinned group (or are otherwise still rendered/reachable)" and this is the simplest interpretation that satisfies the literal assertion text (all names present, exactly 5 pinned) without inventing new UI not requested by the spec.

## Notes for the next worker
- Full-suite baseline diff: ran `npx vitest run tests/unit`, extracted failing file names, diffed against `missions/20260921-212654/baseline-failing-files.txt`. Result: identical set of 46 failing files except `tests/unit/f041-final-gate.test.tsx`, which is in the baseline's 47-file list but did NOT fail in this run — re-ran it in isolation (`npx vitest run tests/unit/f041-final-gate.test.tsx`) and it passed cleanly (4/4), consistent with the task instructions calling this file "known flaky under full-suite load." No new failures introduced; no baseline failures fixed by this change (other than the flaky one resolving itself this run).
- Verified specifically per instructions: `tests/unit/f040-sidebar-recents-fallback.test.tsx` (3 tests) and `tests/unit/f119-sidebar-short-viewport.test.tsx` both still pass after this change, confirming F040's no-favourites/recents-fallback behaviour was not reopened.
- Gotcha for the next person touching this file: `favoriteProjects` (the rendered/capped pinned array) must stay the source of truth for what's "pinned" — don't reintroduce a raw `favoriteIds`-based filter for the other group, or this bug returns.
