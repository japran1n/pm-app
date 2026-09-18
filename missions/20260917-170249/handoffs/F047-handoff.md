# Handoff: F047 — sidebar slug parameterisation

## Status
COMPLETE

## Assertions covered
AS-007: PASS — `tests/unit/app-sidebar-webflow-nav.test.tsx` now runs the full "no per-workspace/role gating" suite (plus every other described block) via `describe.each(["acme", "globex"])`, deriving `expectedHref` from the slug. Mutation-verified: hardcoding `/w/acme/tools/webflow` in `components/nav/app-sidebar.tsx` (dropping the `${workspaceSlug}` interpolation) turned 7 of 22 tests RED (all globex-slugged AS-007 and AS-001/AS-005 href assertions), confirming the test suite now catches this class of mutation. Reverted the mutation; suite is green again (22/22).

## Files changed
tests/unit/app-sidebar-webflow-nav.test.tsx

## Commands run
`npx vitest run tests/unit/app-sidebar-webflow-nav.test.tsx` (0) — baseline green, 22 tests (11 cases x 2 slugs)
`npx vitest run tests/unit/app-sidebar-webflow-nav.test.tsx` (1) — after mutating app-sidebar.tsx href to hardcoded "/w/acme/...", 7 tests failed as expected (RED)
`npx vitest run tests/unit/app-sidebar-webflow-nav.test.tsx` (0) — after reverting the mutation, 22/22 green again
`git commit ...` (0)

## Decisions made
- Used `describe.each(["acme", "globex"])` wrapping the entire existing describe body rather than a smaller helper, so every existing assertion (AS-001, AS-005, AS-006, AS-007, AS-127) in this file gets slug coverage, not just AS-007's own block — this also strengthens the other assertions' mutation resistance as a side effect, without expanding scope (same file, same test IDs already covered).
- Derived `baseProps`/`expectedHref` per slug via a `makeProps(slug)` helper instead of hardcoding literals, so every href expectation in the file reads `expectedHref` (built from the loop variable) instead of a string literal containing "acme".
- Added the definition-of-done case ("standard member, no Webflow-specific flag, item still appears — unconditional") as a third test inside the existing `AS-007` describe block, using `isGuest: false` with no other membership flags, since `AppSidebar`'s props only expose `isGuest` as the relevant gating flag (there is no separate "Webflow flag" on the membership type) — confirmed by reading `components/nav/app-sidebar.tsx`'s `navGroups` signature, which takes no Webflow-specific parameter at all.
- Performed the mutation verification directly against `components/nav/app-sidebar.tsx` (temporarily editing then reverting) as instructed, and confirmed via `git diff` that the file was restored to its pre-mutation state on the relevant line before committing (an unrelated icon-color line in the same file was modified by a concurrent process outside this task's scope; left untouched since it is out of scope for F047 and not part of my edit).

## Out-of-scope work needed
None identified. The other assertions in this file (AS-001, AS-005, AS-006, AS-127) were not required by this feature but incidentally gained slug-parameterised coverage as part of wrapping the whole describe block in `describe.each` — no separate action needed there.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose two slugs ("acme", "globex") rather than more, since the spec said "at least 2" and two distinct, easily-distinguishable slugs are sufficient to catch a hardcoding mutation while keeping the test count reasonable (22 vs 11 originally).

## Notes for the next worker
- The test file's top-of-file comment block was updated to document the F047 scrutiny finding and the parameterisation approach, matching the existing convention in that file (each scrutiny pass documents its own rationale inline).
- Note: while working, an unrelated concurrent change appeared in `components/nav/app-sidebar.tsx` (an icon color class change, `text-muted-foreground` -> `text-tertiary-foreground` on the active-icon branch) that is not part of this feature and was left as-is per the system reminder instructing not to revert externally-modified files.
