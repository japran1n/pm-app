# Handoff: F036 — Stop loading `estimated_by` / `updated_by`

## Status
COMPLETE

## Assertions covered
AS-121: PASS — neither `estimated_by` nor `updated_by` appears in any `.select(...)` call on `task_discipline_estimates` / `architecture_node_meta` in `lib/queries/architecture-details.ts`. Verified by a new static-source regression test (`lib/queries/architecture-details.select.test.ts`) plus a manual `grep` after the change.

## Files changed
lib/queries/architecture-details.ts
lib/architecture/types.ts
lib/queries/architecture-details.select.test.ts (new)
lib/architecture/estimate-rollup.test.ts
components/architecture/estimate-summary.test.tsx
components/architecture/discipline-estimate-note.test.tsx
tests/unit/f011-work-category-unify.test.ts
tests/unit/f006-estimate-rollup.test.ts
tests/integration/f017-new-discipline-estimates.test.ts
tests/unit/sitemap-io.test.ts
tests/unit/f060-discipline-estimate-schema.test.tsx
tests/unit/f030-section-meta-in-exports.test.ts
tests/unit/f022-copy-brief.test.ts

## Commands run
`npx vitest run lib/architecture/estimate-rollup.test.ts components/architecture/estimate-summary.test.tsx components/architecture/discipline-estimate-note.test.tsx lib/queries/architecture-details.select.test.ts --reporter=verbose` (0, 14/14 passed)
`npx tsc --noEmit -p .` (non-zero, but zero errors in any file touched by this feature — see Notes)
`npx eslint <all files listed above>` (0)
`git commit` (0)

## Decisions made
- Scoped this feature strictly to `task_discipline_estimates.estimated_by` and `architecture_node_meta.updated_by`, the two SELECT statements in `lib/queries/architecture-details.ts` (the read path). `updated_by` on the unrelated `docs` table (`lib/queries/docs.ts`, `lib/actions/docs.ts`) was left untouched — different table, different feature spec doesn't name it, and the clarified "Touches" answer points at this feature spec only.
- Left the write paths (`lib/actions/architecture/estimates.ts` upsert of `estimated_by: user.id`, `lib/actions/architecture/node-meta.ts` upsert of `updated_by: user.id`) untouched. AS-121 and the spec text ("stop loading") are about SELECT/read, not INSERT/UPDATE; the DB columns still exist and are still written for audit purposes. Removing the write would be an undocumented behavior change outside this feature's stated scope.
- Removed `estimatedBy`/`updatedBy` from the `DisciplineEstimate`/`NodeMeta` TypeScript types entirely (not just from the query) per "Remove from TypeScript types" in the task description — this is what makes the regression test's type-level check (`no estimatedBy:`/`updatedBy:` in types.ts) meaningful, and it surfaced every other place in the test suite that constructed these types with the now-removed fields (all fixed to compile).
- No UI ever rendered these fields (confirmed via grep across `components/` and `app/`), so there was nothing to remove there.
- Added `lib/queries/architecture-details.select.test.ts`: a static-source test that greps `.select(...)` call strings in the query module and asserts neither column name is present, plus a check that the two types no longer declare the fields. This fails immediately (no DB/network needed) the moment someone re-adds either column to a SELECT list or back to the types, satisfying "Add a test that fails if either field is re-added."

## Out-of-scope work needed
None identified for this feature's stated scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `estimated_by`/`updated_by` DB columns and their INSERT/UPSERT writes intact (only removed from SELECT + types), since the feature title and AS-121 assertion are specifically about not *loading* these fields, not about dropping the columns or stopping the audit-trail write.

## Notes for the next worker
- This repo appears to have another mission/worker actively editing files concurrently in the same working tree during this session (`missions/CURRENT` points at `20260919-131402` while this feature belongs to mission `20260919-150607`, and several unrelated files — e.g. `components/architecture/sortable-section-card.tsx`, `lib/queries/architecture.ts` `description_text`/`description` field rename — showed as modified-but-uncommitted, and files I had just edited were observed reverted to HEAD between tool calls before I re-applied and committed them). None of that unrelated in-flight work is part of F036; I did not touch it.
- Full-repo `npx tsc --noEmit -p .` currently reports errors, but **none of them are in any file this feature touches** (verified by grepping the tsc output for the touched filenames — zero matches). All remaining errors are `BoardPage.description` / `sortable-section-card.tsx` `onDetailsInvalidate` errors from the concurrent unrelated work described above. Recommend re-running `tsc` once that other in-flight work is committed to confirm a clean full-repo baseline.
- Vitest test-file count was not verified against the "≤262" budget (repo currently has ~850 `*.test.ts*` files including files outside `lib/`/`components/`/`tests/`); this feature only added one new test file (`lib/queries/architecture-details.select.test.ts`), net effect on the budget is +1.
