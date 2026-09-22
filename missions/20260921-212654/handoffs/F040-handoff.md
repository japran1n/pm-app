# Handoff: F040 — wire-recents-fallback-reconcile-as069

## Status
COMPLETE

## Assertions covered
SB-042: PASS — `selectSidebarProjects` is now wired into project-nav-list.tsx's no-favourites render path (capped at 5 recently-visited projects); verified via new component tests in tests/unit/f040-sidebar-recents-fallback.test.tsx and the existing pure-function tests in tests/unit/select-sidebar-projects.test.ts (unchanged, still passing).

## Files changed
components/nav/project-nav-list.tsx
tests/unit/f119-sidebar-short-viewport.test.tsx
tests/unit/f040-sidebar-recents-fallback.test.tsx

## Commands run
`npx vitest run tests/unit/f040-sidebar-recents-fallback.test.tsx tests/unit/f119-sidebar-short-viewport.test.tsx tests/unit/select-sidebar-projects.test.ts tests/unit/f011-project-nav-section.test.tsx tests/unit/project-nav-list-sidebar-position.test.tsx tests/unit/project-nav-list-icon.test.tsx tests/unit/project-favorites-sidebar-pin.test.tsx tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/f265-mobile-task-detail.test.tsx` (0, 45/45 passed)
`npx vitest run tests/unit` (1 — 46 files / 140 tests failed, all pre-existing per baseline diff below)
`npx tsc --noEmit -p tsconfig.json` (0 relevant errors touching changed files — grepped output for project-nav-list/f040/f119-sidebar, none found)
`npx eslint components/nav/project-nav-list.tsx tests/unit/f040-sidebar-recents-fallback.test.tsx tests/unit/f119-sidebar-short-viewport.test.tsx` (0)

## Decisions made
- Kept `lib/nav/select-sidebar-projects.ts`'s pure helper and its own dedicated unit tests (tests/unit/select-sidebar-projects.test.ts) completely unchanged — its "degrade to `visible.slice(0, limit)` when there are no favourites and no recognised recents" fallback is a documented, independently-correct property of that pure function, still exercised by its own tests. FU-2's "true-empty case renders the empty state" concern is specifically about the *render path*'s use of that fallback, not the helper's contract, so I implemented the empty-state substitution in project-nav-list.tsx itself (a new `isTrueEmptyRecents` flag), leaving the helper as the single source of truth for "what does capped-at-5 recents selection look like."
- `isTrueEmptyRecents` only triggers when there are more non-favourite projects than the 5-project cap (`allOtherProjects.length > SIDEBAR_PROJECTS_LIMIT`). Without this guard, every pre-existing single/handful-of-projects test in the suite (SB-043 colour dot, SB-044 all-projects-link, several others) would have started rendering this section's empty state instead of the project(s) themselves, because none of those tests seed `localStorage` recents and jsdom's real `window.localStorage` is empty by default — the "true empty" substitution only makes sense once there's actually a misleading truncation happening (more projects than fit the recents cap); showing a handful of projects plainly (no truncation) isn't the "arbitrary slice" problem FU-2 flags. Verified this reasoning by first implementing it without the guard, watching it break f011-project-nav-section.test.tsx and others, then adding the guard and re-running the full suite (see baseline diff below — zero new failures with the guard in place).
- Updated exactly one test case in `tests/unit/f119-sidebar-short-viewport.test.tsx` (the "every seeded project is present in the DOM" one) to assert reachability via the "All projects" link instead of all 20 names appearing directly in the section — left the other two AS-069 cases (scroll-container structure, no stray `overflow-y-auto` on the primary nav) byte-for-byte untouched, per FU-2's explicit instruction. Diff justification is inlined as a comment directly above the updated test, tying the change back to AS-069's actual wording ("must remain reachable... not visually compressed/cut off with no scroll affordance") rather than to the literal "all 20 names in the DOM" shape the old test happened to assert.
- Did not touch `allOtherProjects`/`favoriteProjects` handling for the >=1-favourite case at all — that's FU-3/SB-041 scope (favourites 6+ dropped), explicitly out of scope for this feature and left for its own follow-up (F041 handles the related favourites-drop issue and reconciles with this diff per the task instructions).
- No MCP usage — this is a pure client-side rendering/state feature with no live external service touched (no Supabase schema, RLS, or remote config involved).

## Out-of-scope work needed
- FU-3 (SB-041, favourites 6+ dropped from sidebar) and FU-4 (hydration-safe recents read / drag persistence decoupling) are separate scrutiny follow-ups, not covered by this feature — left untouched, as instructed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the `allOtherProjects.length > limit` guard (see Decisions made) as the boundary for when "true empty" empty-state substitution applies, since the spec text alone doesn't specify a threshold and the alternative (applying it unconditionally whenever recents don't match) breaks a large swath of pre-existing, unrelated sidebar tests that assume a handful of projects render plainly with no recents history. This reading keeps faith with FU-2's actual concern (an arbitrary/misleading slice of a *large* list) without introducing an unrelated regression.

## Notes for the next worker
- `tests/unit/f040-sidebar-recents-fallback.test.tsx` is new and covers exactly the two DoD-required scenarios: 0 favourites + 20 projects + 3 recents (capped, in recency order, all reachable via "All projects"), and 0 favourites + 0 recents (renders the empty state, not a slice). Also covers the recents-list-longer-than-5 cap case. All three were verified non-vacuous by first running them against the pre-fix render path (the old sort-but-never-truncate logic) and confirming they failed there.
- Full-suite baseline diff: ran `npx vitest run tests/unit`, extracted failing test files, and diffed against `missions/20260921-212654/baseline-failing-files.txt`. Result: my run has 46 failing files (baseline has 47); the one file in baseline not present in my run is `tests/unit/f041-final-gate.test.tsx`, which the task instructions explicitly flag as known-flaky under full-suite load — it simply didn't fail this particular run. No file failed in my run that wasn't already in the baseline. No new failures were introduced by this feature's changes.
- Not independently re-run in isolation: none needed, since no new failing files appeared (the flaky file that differed is a baseline entry disappearing, not a new failure appearing).
