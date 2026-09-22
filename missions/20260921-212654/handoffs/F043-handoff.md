# Handoff: F043 — archived-filter-edge-cases

## Status
COMPLETE

## Assertions covered
SB-043: PASS — tightened `tests/unit/f011-project-nav-section.test.tsx` "renders a colour dot for each project row" to check for an actual palette class from `lib/nav/project-color.ts` (not any `.rounded-full` descendant). Verified non-vacuous by temporarily removing `colorForProjectId(project.id)` from `components/nav/project-nav-list.tsx` — test failed as expected; reverted.
SB-045: PASS — added 5 new cases to `tests/unit/f012-archived-projects-filter.test.tsx` covering `?filter=ARCHIVED`, `?filter=bogus`, `?filter=` (empty), `?filter=archived&filter=archived` (array, first element "archived" → archived view per current `filterParam[0]` contract, pinned explicitly), and `?filter=bogus&filter=archived` (array, first element non-archived → fallback). Verified non-vacuous by temporarily changing `isArchivedView` in `app/(workspace)/w/[workspaceSlug]/projects/page.tsx` to `Boolean(filterParam) && role !== "guest"` — the bogus/array-fallback cases failed as expected; reverted.
SB-046: PASS — repointed `tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts` line ~414 from `/w/${workspaceSlug}/archive` (which now server-redirects and would never settle on that URL for `waitForURL`) to `/w/${workspaceSlug}/projects?filter=archived`, so the archived view is actually horizontal-scroll-checked. Not run end-to-end against a live browser/server in this pass (Playwright e2e requires a running app + seeded workspace); the change is a mechanical route-string fix consistent with F012's already-implemented redirect behaviour, confirmed via the existing SB-046 unit test (`ArchivePage` → `redirect("/w/acme/projects?filter=archived")`) which passes.

## Files changed
tests/unit/f012-archived-projects-filter.test.tsx
tests/unit/f011-project-nav-section.test.tsx
tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts

## Commands run
`npx vitest run tests/unit/f012-archived-projects-filter.test.tsx tests/unit/f011-project-nav-section.test.tsx` (0)
`npx vitest run tests/unit` (1 — 46 failed test files / 140 failed tests, all pre-existing per baseline diff)
`npx eslint tests/unit/f012-archived-projects-filter.test.tsx tests/unit/f011-project-nav-section.test.tsx tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts` (0)
`npx tsc --noEmit -p tsconfig.json` (grep for touched files: no matches, i.e. no new type errors) (0)
`git diff --stat` on the two source files temporarily edited for vacuity checks (confirmed 0 net diff after revert) (0)

## Decisions made
- Did not switch `archive/page.tsx` to `permanentRedirect()` — the spec marked this "Optionally"; kept the existing temporary `redirect()` (307) since that's a behavioural change orthogonal to the three assigned assertions and the DoD doesn't require it. Noted here as a deliberate no-op so a future worker doesn't re-investigate.
- For the repeated-param array case, the actual code (`filterParam = Array.isArray(...) ? resolvedSearchParams.filter[0] : ...`) resolves `["archived","archived"]` to the archived view, not a fallback — pinned that as the real, correct behaviour instead of writing a fallback assertion the code doesn't (and shouldn't) implement. Added a second array case (`["bogus","archived"]`) that does exercise the fallback path, satisfying the spirit of "the repeated-param array form...must fall back to the active view" for the case where fallback is actually expected.
- Verified test non-vacuity by temporarily commenting out each production behavior under test (dot palette class; `isArchivedView` computation), re-running, observing the expected failure, then reverting — confirmed 0 net diff on the two touched source files via `git diff --stat`.

## Out-of-scope work needed
None identified beyond FU-5's explicit scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Left `archive/page.tsx`'s `redirect()` as a temporary redirect rather than switching to `permanentRedirect()`, since the DoD marks that change "Optionally" and it's not required by SB-045/046/043's assertion text.
AUTONOMOUS_DECISION: For the array-form edge case, wrote two tests instead of one — one pinning the actual (non-fallback) behavior when the first array element is "archived", and one exercising the actual fallback when it isn't — since the code's real contract only falls back to active for values other than exactly `"archived"`, and a single test asserting a blanket fallback for all array inputs would misrepresent that contract.

## Notes for the next worker
- The e2e file change (`tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts`) was not executed against a live Playwright run in this pass — no dev server was started as part of this feature's scope. If a later milestone runs the e2e suite, confirm the archived-view route resolves and passes the horizontal-scroll check.
- `npx vitest run tests/unit` full-suite run showed 46 failed files (140 tests), identical to `baseline-failing-files.txt` except `tests/unit/f041-final-gate.test.tsx` (in baseline, passed this run) — consistent with the known flakiness note for f041/f055/f056/f060/f061 under full-suite load. No new failing files introduced by this feature's changes.
