# Handoff: F004 — planner layout derivation

## Status
COMPLETE

## Assertions covered
AS-016: PASS — resolvePlannerLayout(1) and (0) return "week-grid"; verified via vitest
AS-017: PASS — resolvePlannerLayout(2) and (5) return "stacked"; verified via vitest

## Files changed
lib/calendar/planner-layout.ts
tests/unit/planner-layout.test.ts

## Commands run
`npx vitest run tests/unit/planner-layout.test.ts` (0)
`git add lib/calendar/planner-layout.ts tests/unit/planner-layout.test.ts && git commit` (0)

## Decisions made
- Function is pure, taking only `selectionCount: number`, no view/request input, per spec note "the layout is derived, never requested."
- Boundary chosen as `<= 1` → "week-grid", `>= 2` → "stacked", matching AS-016 (exactly one) and AS-017 (two or more). Also tested count 0 defensively (falls into week-grid) even though not an explicit assertion, since it's a natural boundary case for the same predicate.
- No MCP usage: this is pure logic with no external service dependency (per tech-decisions.md, no new deps needed).

## Out-of-scope work needed
- Wiring `resolvePlannerLayout` into the actual Planner page/component (app/(workspace)/w/[workspaceSlug]/calendar/page.tsx, components/calendar/stacked-planner.tsx, week-view.tsx) is not part of F004 per the "Files (approximate)" list — left for the features that own those components (e.g. F016, F031-F036 per tech-decisions.md file layout).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `<= 1` / `>= 2` comparison rather than strict `=== 1` / `=== 2` so the function is total over all non-negative integers (and defensively over negative counts too), since the assertions only specify "exactly one" and "two or more" but a pure derivation function should have well-defined behavior for the full domain.

## Notes for the next worker
Only `lib/calendar/planner-layout.ts` was touched, matching tech-decisions.md's file layout for F004. This is a standalone pure function with zero dependencies on F002's `people-selection.ts` (that file exists in the working tree but was not modified or imported here — F004's spec explicitly separates the two concerns: F002 tracks selection, F004 only consumes a count).
