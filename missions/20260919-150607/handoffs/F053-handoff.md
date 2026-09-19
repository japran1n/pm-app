# Handoff: F053 — section_kind single source of truth

## Status
COMPLETE

## Assertions covered
AS-014: PASS — `SECTION_KINDS` const array is the single source; `sectionKindEnum` is derived via `z.enum(SECTION_KINDS)`; `section-kind-selector.tsx` now builds its options list from `sectionKindEnum.options` instead of a hand-written array; `tests/unit/f053-section-kind-drift.test.ts` parses the `tasks_section_kind_check` CHECK constraint out of the migration SQL and asserts it matches `SECTION_KINDS` as a set (passing).

## Files changed
lib/validation/architecture.ts
components/architecture/section-kind-selector.tsx
tests/unit/f053-section-kind-drift.test.ts

## Commands run
`npx vitest run tests/unit/f053-section-kind-drift.test.ts` (0, 1 passed)
`npx tsc --noEmit` (0)
`npx eslint lib/validation/architecture.ts components/architecture/section-kind-selector.tsx tests/unit/f053-section-kind-drift.test.ts` (0)
`npm run test` (0 exit / 210 pre-existing failures unrelated to this change — see Decisions made)

## Decisions made
- Added `export const SECTION_KINDS = ["static", "cms"] as const;` immediately above `sectionKindEnum` in `lib/validation/architecture.ts`, and derived `sectionKindEnum = z.enum(SECTION_KINDS)` and `export type SectionKind = z.infer<typeof sectionKindEnum>` from it, per the spec's exact snippet.
- `components/architecture/section-kind-selector.tsx` already exported its own local `SectionKind` type alias (`= BoardSectionKind`) used throughout the file's props/JSX; left that alias in place (renaming it would touch call sites outside this feature's scope) and only replaced the hand-written `const KINDS: SectionKind[] = ["static", "cms"]` with `const KINDS = sectionKindEnum.options as SectionKind[]`, importing `sectionKindEnum` from `@/lib/validation/architecture`. `BoardSectionKind` and the new `SectionKind` type from validation/architecture.ts are structurally identical (`"static" | "cms"`), so the cast is safe and no other file needed changes.
- Drift test parses the CHECK constraint directly from `supabase/migrations/20261124010000_architecture_cms_template_and_section_kind.sql` via regex (`tasks_section_kind_check ... in (...)`) rather than requiring a live DB connection — matches the "no DB connection in unit tests" convention already used elsewhere in `tests/unit`. Test name includes "AS-014" per instructions.
- Verified the ~210 vitest failures present both before (via `git stash`) and after my change are pre-existing baseline failures (`supabase.rpc is not a function` mock gaps in `lib/queries/watching.ts` tests, and an unrelated realtime/comments hook test) — unrelated to F053's files. Confirmed by stashing my two edits and re-running `tests/unit/watching-feed-query.test.ts` alone: it fails identically without my change present.

## Out-of-scope work needed
The pre-existing `supabase.rpc is not a function` failures in `tests/unit/watching-feed-query.test.ts` and the realtime-hook related test failures across the suite (~210 failing tests) are unrelated to this feature and were not introduced by it. A future feature should investigate the Supabase mock/test-double setup used across `tests/unit` — it appears not to stub `.rpc()` on the mock client used by `lib/queries/watching.ts` and possibly other query modules.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the component-local `SectionKind` type alias in `section-kind-selector.tsx` (`= BoardSectionKind`) rather than switching it to import the new `SectionKind` type from `lib/validation/architecture.ts`, since the spec only asked to replace the hand-written options array with `sectionKindEnum.options`, not to unify the type alias, and doing so would touch `components/architecture/section-card-menu.tsx` (which imports `SectionKind` from the selector file) — out of this feature's declared touch scope.

## Notes for the next worker
No MCP tools were used — this feature is pure application-code/schema-consistency work with no live external service state to inspect. The migration file already existed from a prior mission (20261124010000_architecture_cms_template_and_section_kind.sql); no new migration was needed since the DB constraint values already match SECTION_KINDS.
