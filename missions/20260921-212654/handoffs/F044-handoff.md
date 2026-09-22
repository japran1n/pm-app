# Handoff: F044 — cap-section-in-every-branch

## Status
COMPLETE

## Assertions covered
SB-041: PASS — with 1 favourite + 30 projects, `nav[aria-label="Projects"]` now renders exactly 5 links total (favourite + budget-filled others), not the previously-unbounded full list; with 8 favourites, exactly 5 links total (pinned group fills the whole budget). Read SB-041's literal text ("the sidebar Projects section lists up to 5 favorited projects") before deciding — it says nothing about the OTHER rows in the section, so capping the section's TOTAL at the same limit is a reading the existing assertion already permits. Did not touch validation-contract.md; no superseding assertion added.
SB-042: PASS — 0-favourites branch (recent-fallback / true-empty-state) untouched and still passing; guarded by existing tests/unit/select-sidebar-projects.test.ts and project-nav-list tests.

## Files changed
components/nav/project-nav-list.tsx
tests/unit/f041-favorites-overflow.test.tsx
tests/unit/f044-cap-section-in-every-branch.test.tsx

## Commands run
`npx vitest run tests/unit/f044-cap-section-in-every-branch.test.tsx tests/unit/f041-favorites-overflow.test.tsx tests/unit/select-sidebar-projects.test.ts` (0)
`npx vitest run tests/unit` (1 — 46 files / 140 tests failed, all pre-existing per baseline diff below)
`npx tsc --noEmit -p .` (checked; no errors attributed to touched files)
`npx eslint components/nav/project-nav-list.tsx tests/unit/f044-cap-section-in-every-branch.test.tsx tests/unit/f041-favorites-overflow.test.tsx` (0, no output)
Non-vacuous check: temporarily reverted the fix (`selectRemainingOthers(allOtherProjects, remainingSlots)` → `allOtherProjects`) and re-ran the new F044 tests — both failed as expected (30-project case got 30 links instead of 5, 8-favourite case got 8 instead of 5), then restored the fix via `mv project-nav-list.tsx.bak project-nav-list.tsx` (never used `git stash`/`git checkout --`).

## Decisions made
- Read SB-041/validation-contract.md text directly (per the orchestrator decision in the spec) before implementing. Its text — "the sidebar Projects section lists up to 5 favorited projects" — talks only about favourited projects, not the section's total row count, so it does not mandate "ALL favourites must always render." That satisfies the spec's first branch: cap the WHOLE section at `SIDEBAR_PROJECTS_LIMIT` and do not add a superseding assertion.
- This necessarily supersedes part of F041's "6th+ favourite spills into the non-pinned group, guaranteed visible" behaviour. Updated `f041-favorites-overflow.test.tsx` in place (not validation-contract.md — that file was never touched) with an explicit header comment documenting the supersession and pointing at the new F044 test file, rather than leaving a test that now contradicts the intended behaviour.
- Implemented remaining-budget ordering as "recents first, then the rest of `allOtherProjects` in existing sidebar_position order" per FU-17's explicit "pinned favourites first, then recents, then remaining projects, truncating the combined list" instruction. Used a small local helper (`selectRemainingOthers`) rather than reusing `selectSidebarProjects` because that helper's "recentVisible-or-nothing" behaviour doesn't combine recents + remainder the way FU-17 asks for.
- Left the 0-favourites (`noFavourites`) branch's existing logic completely untouched to avoid regressing the already-tested SB-042 behaviour; only added a defensive `.slice(0, SIDEBAR_PROJECTS_LIMIT)` on its already-bounded fallback arm (no behaviour change, since that arm is only reached when `allOtherProjects.length <= SIDEBAR_PROJECTS_LIMIT`).
- No MCP usage — pure client-side UI logic, no live service state involved (per `mcp-registry.md`'s decision tree: "Pure UI feature → No MCP").

## Out-of-scope work needed
None identified beyond FU-17's own scope. The drag-and-drop reorder logic (`handleDragEnd`) still computes indices against the full `allOtherProjects` (not the truncated `otherProjects` view) per F042's existing, unmodified rationale — untouched and out of scope here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to cap the whole section (not just pinned group) and leave validation-contract.md untouched, per the literal SB-041 text as instructed by the spec's own decision tree — documented inline in project-nav-list.tsx's new comment block so a future reader doesn't have to re-derive the reasoning.

## Notes for the next worker
- Full `npx vitest run tests/unit` run: 46 failed files / 140 failed tests, identical to `baseline-failing-files.txt` except `tests/unit/f041-final-gate.test.tsx`, which is now PASSING (was in the baseline-failing list) — re-ran it in isolation (`npx vitest run tests/unit/f041-final-gate.test.tsx`) and it passed cleanly (4/4), so this is a net improvement, not a new failure; not investigated further since it's not part of this feature's touched files.
- Live/browser verification: NOT performed — this is a pure unit-tested UI change (jsdom render tests only); no dev server was started, no manual browser check was done. State precisely: nothing beyond the vitest render-test evidence above was verified.
- `f041-favorites-overflow.test.tsx`'s original assertion ("all 8 favourite names present somewhere in the nav") was deliberately changed to match the new whole-section cap (5 links total) — this is a test-file edit, not a validation-contract.md edit, and is explained in that file's own updated header comment.
