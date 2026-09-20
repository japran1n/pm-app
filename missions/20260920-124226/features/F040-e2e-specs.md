# F040: e2e specs

**Milestone:** M8 — Polish
**Estimated worker time:** 45 minutes
**Depends on:** F031,F035

## Assertion IDs covered
- AS-077: An end-to-end test proves the Planner opens on the signed-in member's own blocks.
- AS-078: An end-to-end test proves selecting a second member switches the Planner to the stacked layout.
- AS-079: An end-to-end test proves another member's block cannot be dragged.

## Draft scope
- E2E: the Planner opens on the caller's own blocks.
- E2E: selecting a second person switches to stacked.
- E2E: another member's block will not drag.

## Files (approximate)
- `tests/e2e/planner-team-view.spec.ts`

## Notes for clarification
Three specs, matching answer 28's 'unit for pure functions plus a couple of E2E'.
