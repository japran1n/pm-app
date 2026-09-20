# Handoff: F119 — Fix AS-160: duplicate id guard in reorderComponents

## Status
COMPLETE

## Assertions covered
AS-160: PASS — new tests "AS-160 duplicate ids are rejected" and "AS-160 foreign id rejected" pass in tests/unit/m8-reorder-components.test.ts, along with the pre-existing "AS-160: an incomplete component list is rejected" test.

## Files changed
lib/validation/architecture.ts
lib/actions/architecture/components.ts
tests/unit/m8-reorder-components.test.ts

## Commands run
`npx vitest run tests/unit/m8-reorder-components.test.ts --reporter=verbose` (0) — 5 passed
`npx tsc --noEmit` (0)
`npx eslint lib/validation/architecture.ts lib/actions/architecture/components.ts --max-warnings=0` (0)

## Decisions made
- Added `.refine((ids) => new Set(ids).size === ids.length, { message: "Component IDs must be unique" })` directly to the `componentIds` array field in `reorderComponentsSchema`, exactly as specified in the clarified spec.
- Added a defense-in-depth length check in the `reorderComponents` action comparing `parsed.data.componentIds.length` against `(existingComponents ?? []).length`, placed immediately after the existing Set-based completeness check (`isComplete`). Kept the existing completeness check's error message ("Component list is incomplete.") unchanged so the pre-existing "AS-160: an incomplete component list is rejected" test (which asserts that exact string) still passes; the new length check uses its own message "Component list is incomplete or contains duplicates" per the spec, and only fires when the Set check already passed (i.e. genuine duplicate-with-matching-size case).
- New "AS-160 duplicate ids are rejected" test submits `[COMP_1, COMP_1, COMP_2]` (2 distinct ids) against a 3-component project — this is caught by the schema's uniqueness refine at `safeParse` time, before it ever reaches the action's DB logic.
- New "AS-160 foreign id rejected" test submits `[COMP_1, COMP_2, FOREIGN_ID]` — same length (3) as existing components, so it passes the new length-based check, but is rejected by the pre-existing Set-membership completeness check because FOREIGN_ID isn't among the project's real component ids.

## Out-of-scope work needed
None observed beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — implementation followed the clarified spec directly)

## Notes for the next worker
- Did not touch `tests/unit/f048-component-panel-dnd.test.tsx` per instructions.
- Only committed the three files scoped to this feature (`lib/validation/architecture.ts`, `lib/actions/architecture/components.ts`, `tests/unit/m8-reorder-components.test.ts`); left other unstaged/untracked files in the working tree (other workers' in-flight handoffs, plan.md, run-log.md, missions/CURRENT, and other test file changes) untouched since they belong to other features/orchestrator state.
