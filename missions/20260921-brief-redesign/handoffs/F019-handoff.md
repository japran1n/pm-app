# Handoff: F019 — Update f061 submit gate test for non-blocking Next

## Status
COMPLETE

## Assertions covered
BR-041: PASS — Next lands on review with warning when required empty
BR-044: PASS — missing required highlighted (summary + not-answered), Submit disabled
BR-003: PASS — submitBrief never called; clicking disabled Submit does nothing

## Files changed
tests/unit/f061-submit.test.tsx
missions/20260921-brief-redesign/handoffs/F019-handoff.md

## Commands run
`npx vitest run` f061-submit, f055, f057, f060-required-validation (0; 23 tests pass)
`npx eslint tests/unit/f061-submit.test.tsx` (0)

## Decisions made
- Kept AS-124 intent (no submit while required unanswered); test renamed to describe new behaviour.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions

## Notes for the next worker
Test-only change; no source touched.
