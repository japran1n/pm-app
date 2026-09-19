# Handoff: F099 — Tighten select-guard regex

## Status
COMPLETE

## Assertions covered
AS-114: PASS — `lib/queries/architecture.select.test.ts` describe block at line 43 now labeled `AS-114: TypeScript types no longer include description on PageComponent/BoardComponent`; its two `description\s*:` regex guards were widened to `description\s*\?\s*:` so an optional field (`description?: string;`) on `BoardComponent`/`ComponentRow` also fails the test. Mutation-verified: temporarily added `description?: string;` to `BoardComponent` in `lib/queries/architecture.ts`, ran the suite, confirmed the AS-114 test (`BoardComponent type declaration does not declare a description field`) went red, then reverted.

## Files changed
lib/queries/architecture.select.test.ts
missions/20260919-150607/handoffs/F032-handoff.md

## Commands run
`npx vitest run lib/queries/architecture.select.test.ts` (0) — 7 passed after fix
`npx vitest run lib/queries/architecture.select.test.ts` (1) — 6 passed / 1 failed during mutation-verify with `description?: string;` added to BoardComponent (expected red)
`npx vitest run lib/queries/architecture.select.test.ts` (0) — 7 passed after reverting mutation
`npm run test` (0) — full suite passed

## Decisions made
- Regex changed from `/description\s*:/` to `/description\s*\?\s*:/` at both occurrences (lines 49 and 57) so the guard also catches optional-field declarations like `description?: string;`, not just required `description: string;`.
- Swapped the two describe-block labels to match `validation-contract.md`: line 14 (query/COMPONENT_COLUMNS checks) is AS-113, line 43 (TypeScript type checks) is AS-114. Previously they were reversed relative to the contract.
- Also corrected the same label swap (AS-113 ↔ AS-114) in `missions/20260919-150607/handoffs/F032-handoff.md` so its assertion notes and inline comment match the contract and the now-corrected test file.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — mapping was determined directly from `validation-contract.md` lines 124-126, no ambiguity)

## Notes for the next worker
Unrelated local modifications exist in the working tree (e.g. `components/architecture/page-column-header.tsx`, `components/architecture/page-column.tsx`, several `tests/unit/f0*.test.tsx` files, `lib/architecture/estimate-rollup.test.ts`) from other in-progress work outside this feature's scope. Only `lib/queries/architecture.select.test.ts` and `missions/20260919-150607/handoffs/F032-handoff.md` were staged and committed for F099; the other modified files were left untouched and unstaged.
