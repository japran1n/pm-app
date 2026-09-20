# Handoff: F094 — Fix AS-023/F088: source check targets live JSX not comment

## Status
COMPLETE

## Assertions covered
AS-023: PASS — Planner layout ("week-grid" vs "stacked") is derived purely from selected-people count, and the shared header (incl. people switcher) must stay outside/above that layout branch. `tests/unit/f088-planner-header-lift.test.tsx` now strips source comments before checking `<PlannerHeader>`'s call site, so a comment containing the literal text "<PlannerHeader" can no longer masquerade as the real JSX. Verified with a manual mutation (moved the real `<PlannerHeader>` JSX inside the `layout === "stacked"` branch) — 3 of 7 tests failed as expected, confirming the test now actually catches the F088 regression it targets.

## Files changed
tests/unit/f088-planner-header-lift.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f088-planner-header-lift.test.tsx` (0, 7/7 passed)
mutation check: temporarily edited `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` to render `<PlannerHeader>` inside the `layout === "stacked"` branch, reran the test file, confirmed 3/7 tests failed, then restored the file byte-for-byte from a backup (`diff` confirmed identical, and `git diff` on that file matches the pre-existing unrelated working-tree state exactly).

## Decisions made
- Added a `stripComments()` helper (strips `/* */` block comments — which also covers JSX `{/* */}` comments — and `//` line comments) and ran it before every source-level regex/indexOf check in the test file, per the spec's root-cause diagnosis.
- Used `layout === "` (not `resolvePlannerLayout(`) as the "layout conditional" marker for check 1, per the spec: `resolvePlannerLayout(...)` is the value computation that legitimately runs before `<PlannerHeader>` regardless of the bug; the actual branch-picking conditional (`if (layout === "stacked") { ... }` inside `WeekGridSection`) is the one that must come after.
- Implemented all three checks from the spec as separate `it(...)` blocks: (1) PlannerHeader index < layout-conditional index, (2) negative regex `/(layout|week-grid|stacked)[\s\S]{0,200}<PlannerHeader/` must not match, (3) exactly one `<PlannerHeader` occurrence in the comment-stripped source. Kept the original PlannerHeader-vs-Suspense check too (also switched to comment-stripped source) since it still adds signal and nothing in the spec asked to remove it.
- Did not touch `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` itself — the feature is a test-only fix; the file already correctly renders `<PlannerHeader>` above the layout branch (F088 is implemented correctly, only the regression-test was weak).

## Out-of-scope work needed
None identified for this feature. Noted but untouched: the working tree already carries an unrelated, uncommitted change to the same `page.tsx` file (a `buildBlockUserIds` helper wired in, apparently from in-progress F090 work) — pre-existing before this feature started, left as-is since it is out of this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to strip comments globally (both `//` and `/* */`, which also neutralizes JSX `{/* */}` comments since they use `/* */` internally) rather than only removing the one specific comment line, so the test is robust against any future comment mentioning `<PlannerHeader>` in prose, not just the current one.

## Notes for the next worker
The mutation test I ran manually (not committed, done via a throwaway Python script against a `/tmp` backup, restored immediately) is a good template if `F088`/`AS-023` regresses again: move the real `<PlannerHeader>` JSX into the `layout === "stacked"` conditional and confirm the "exactly once" and "not near layout keywords" tests both fail — that's the signal the hardened test is still doing its job.
