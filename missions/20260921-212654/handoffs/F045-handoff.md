# Handoff: F045 — unconditional-empty-state-boundaries

## Status
COMPLETE

## Assertions covered
SB-042: PASS — with 0 favourites and 0 recognised recent visits, the section now always renders "No recent projects. Browse all projects below." regardless of how many other projects exist; pinned with tests at 0 (falls into the pre-existing "No projects yet." branch, a different but also-correct empty state), 3, 5, and 6 projects in tests/unit/f045-project-nav-empty-state-boundary.test.tsx (test_SB_042_empty_state_unconditional_on_project_count). Verified non-vacuous: reverting the `isTrueEmptyRecents` change (re-adding `allOtherProjects.length > SIDEBAR_PROJECTS_LIMIT`) makes the 3/5-project cases fail (they'd render the projects plainly instead of the empty message) — confirmed by hand before committing.
SB-044: PASS — "All projects" link is asserted to be the last `<a>` element rendered in the section across the 3/5/6-project 0-favourites/0-recents boundary cases, and separately with a mixed favourite+non-favourite project list, in tests/unit/f045-project-nav-empty-state-boundary.test.tsx (test_SB_044_all_projects_link_is_last). Pre-existing SB-044 coverage in tests/unit/f011-project-nav-section.test.tsx (link exists, correct href, still present when list is empty) continues to pass.

## Files changed
components/nav/project-nav-list.tsx
tests/unit/f045-project-nav-empty-state-boundary.test.tsx (new)
tests/unit/f011-project-nav-section.test.tsx
tests/unit/project-nav-list-sidebar-position.test.tsx
tests/unit/app-sidebar-project-nav-list.test.tsx
tests/unit/project-nav-list-icon.test.tsx
tests/unit/project-favorites-sidebar-pin.test.tsx
tests/unit/f018-sidebar-mobile-sheet.test.tsx
tests/unit/f022-sb023-computed-height.test.ts
tests/unit/f025-sb009-real-375px.test.ts
tests/unit/f265-mobile-task-detail.test.tsx

## Commands run
`npx vitest run tests/unit/f045-project-nav-empty-state-boundary.test.tsx tests/unit/f011-project-nav-section.test.tsx tests/unit/project-nav-list-sidebar-position.test.tsx tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/select-sidebar-projects.test.ts tests/unit/project-nav-list-icon.test.tsx tests/unit/project-nav-dot-contrast.test.ts` (0)
`npx vitest run tests/unit` full suite (140 failed / 3720 passed — see Decisions below for baseline diff) (non-zero exit, expected — pre-existing baseline failures)
`npx tsc --noEmit -p .` (grepped for touched files: no matches / clean)
`npx eslint components/nav/project-nav-list.tsx <all touched test files>` (0, no output)

## Decisions made
- Read SB-042 as unconditional per the FU-18 instruction: "with 0 favorites, up to 5 recently visited; with none, an empty state" says nothing about how many OTHER (non-recent, non-favourite) projects exist. Dropped the `allOtherProjects.length > SIDEBAR_PROJECTS_LIMIT` conjunct from `isTrueEmptyRecents` in `components/nav/project-nav-list.tsx` — it is now exactly `noFavourites && !hasRecentMatch`. Did NOT choose the "show existing ≤5 projects" alternative FU-18 offered, since nothing in SB-042's text supports it and the new reading is simpler and fully testable.
- Simplified the now-redundant `otherProjects` ternary: the previous `allOtherProjects.slice(0, SIDEBAR_PROJECTS_LIMIT)` fallback branch is dead code once `isTrueEmptyRecents` covers exactly the "0 favourites, 0 matched recents" case — replaced with a direct `[]`.
- `lib/nav/select-sidebar-projects.ts` (the pure helper) was intentionally left untouched — its own documented "degrade to `visible.slice(0, 5)` rather than empty" behaviour is a property of that pure function used elsewhere (and independently unit-tested in tests/unit/select-sidebar-projects.test.ts), not the render-path bug FU-18 flagged. FU-18's own text explicitly says this fallback "is still correct and still covered by its own unit tests."
- Several pre-existing tests fixtures (single/few non-favourite projects, no recent-visit mock) previously rendered plainly under the old length-gated fallback and now correctly hit the empty state, breaking tests whose actual focus was something else (drag order, icon/key display, star toggle, mobile 44px targets, mobile Sheet nav tree, computed row height). Fixed each by either adding `isFavorite: true` to a fixture project (files testing something unrelated to favourites/recents) or mocking `readRecentProjectIds` to report a recognised recent visit (files that specifically needed non-favourite rows, e.g. drag reorder and the favourite-star-toggle test) — this keeps each file's own actual assertion intact while routing around the (now correct) empty-state boundary. None of these edits touch assertion intent; they only adjust fixture data so the right code path is exercised.
- Verified 0-project boundary case renders the pre-existing top-level "No projects yet." state (a different, unrelated empty-state branch that fires before this feature's `isTrueEmptyRecents` logic is ever reached, since `projects.length === 0` short-circuits earlier) rather than "No recent projects..." — both are valid empty states for their respective conditions, so this is correct, not a gap.

## Out-of-scope work needed
None identified beyond this fix's own scope. FU-18 explicitly scoped this to the `isTrueEmptyRecents` conjunct and the SB-044 "last element" assertion; both are done.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "drop the length conjunct" over "keep it and add a superseding assertion" per FU-18's own either/or — SB-042's existing text already reads cleanly as unconditional, so no new assertion ID was needed or added (validation-contract.md untouched, per its immutability rule).

## Notes for the next worker
- `isTrueEmptyRecents` in `components/nav/project-nav-list.tsx` is now `noFavourites && !hasRecentMatch` — if a future feature wants to bring back a length-based fallback, it must add a new assertion ID (never edit SB-042) and this file's own header comment on that line documents why the old conjunct was removed.
- No MCP tools used — this is a pure client-side React/UI fix with no external service or live schema involved.
- Full `npx vitest run tests/unit` diffed clean against `missions/20260921-212654/baseline-failing-files.txt`: zero new failing files. One file (`tests/unit/f041-final-gate.test.tsx`) that was in the baseline-failing list now passes — this is unrelated to this feature (a likely timing-flaky test elsewhere in the suite) and was not touched by this change; verified in isolation it also passes standalone.
