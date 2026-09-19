# Handoff: F095 — Fix F070 estimatedBy assertion in read-back test

## Status
COMPLETE

## Assertions covered
AS-121: PASS — `npx vitest run tests/unit/f070-architecture-details-readback.test.ts` now passes 5/5 after removing `estimatedBy` from the four `toEqual` objects.

## Files changed
tests/unit/f070-architecture-details-readback.test.ts

## Commands run
`npx vitest run tests/unit/f070-architecture-details-readback.test.ts` (0) — 5 passed

## Decisions made
- Removed `estimatedBy` key only from the four affected `toEqual` object literals (content_seo, pm, qa, and the cleared-row test), leaving `toEqual` (not `toMatchObject`/`objectContaining`) intact so the assertion still fails on unexpected extra fields.
- Added a comment above each edited `toEqual` noting the shape is deliberately `{discipline, minutes, note}` since F036 removed `estimatedBy` from `DisciplineEstimate`.
- Did not touch the `estimated_by` field in the mock row fixtures (`estimateRows`) or the descriptive header comment at the top of the file — those still reference `estimatedBy`/`estimated_by` as raw input data description, which is out of scope for this fix (the spec only asked to remove `estimatedBy` from the four `toEqual` calls).

## Out-of-scope work needed
None identified. The top-of-file comment still mentions "estimatedBy value per discipline" as part of describing the raw mock data shape (input rows still have `estimated_by` field, unrelated to output shape) — left as is since it's accurate to the mock data, not the assertion.

## Blockers


## Autonomous decisions


## Notes for the next worker
No MCP usage needed for this fix (pure unit test file change, no external service). Verified via `npx vitest run` directly on the single test file per spec instructions.
