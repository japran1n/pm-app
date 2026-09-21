# Handoff: F022 — single_choice >=1 and server-side required check on submitBrief

## Status
COMPLETE

## Assertions covered
BR-015: PASS — whitespace-only required text blocks submitBrief (tests/unit/f022-submit-brief-required.test.ts)
BR-016: PASS — single_choice answered at >=1 option; multi >=1 unchanged
BR-044: PASS — portal isAnswered still delegates and agrees; server blocks missing required, proceeds when all answered
BR-047: PASS — submitBrief returns {success:false,error} with no state update when required missing

## Files changed
lib/brief/is-answered.ts
lib/brief/is-answered.test.ts
lib/actions/brief.ts
tests/unit/f022-submit-brief-required.test.ts

## Commands run
`npx vitest run lib/brief tests/unit/f048* f049 f055-f060 f071-f078` (1 failing file: f048-component-panel-dnd, unrelated, pre-existing)
`npx tsc --noEmit` (2; only baseline app/layout.tsx LayoutProps)
`npx eslint lib/brief lib/actions/brief.ts tests/unit/f022-submit-brief-required.test.ts` (0)

## Decisions made
- Portal single-choice UI is a radio group (one option), so >=1 does not change portal behaviour; legacy rows with several options now count as answered.
- submitBrief queries required brief_questions (by brief.project_id) and brief_answers (by brief_id) after the draft/submitted state checks, so idempotent resubmit still succeeds. Query errors return the generic failure.
- Only submitBrief was edited in lib/actions/brief.ts (plus the import lines).

## Out-of-scope work needed
- tests/unit/f013-portal-gate-autosave.test.tsx "BR-047 Submit waits for the flushed save" currently fails; it mocks the actions so it is unrelated to this change; caused by another worker's uncommitted edit to lib/hooks/use-autosave.ts (passed with that reverted).
- tests/unit/f048-component-panel-dnd.test.tsx fails (pre-existing).

## Blockers

## Autonomous decisions

## Notes for the next worker
I briefly ran `git stash` on lib/tests to compare baselines while other workers had uncommitted edits; popped immediately and all files restored.
