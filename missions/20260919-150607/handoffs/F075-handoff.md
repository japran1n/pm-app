# Handoff: F075 — Fix AS-082: remove singular actions + fix F023 test

## Status
COMPLETE

## Assertions covered
AS-082: PASS — `setDisciplineEstimate` and `clearDisciplineEstimate` are removed from `lib/actions/architecture/estimates.ts` and the `lib/actions/architecture.ts` barrel; `setDisciplineEstimatesBulk` is the sole discipline-estimate write path. Confirmed via `npx tsc --noEmit` (0 errors — no lingering references anywhere in the codebase) and the full unit suite.

## Files changed
lib/actions/architecture/estimates.ts
lib/actions/architecture.ts
tests/unit/f023-singular-actions-decision.test.ts (deleted)
tests/unit/f020-clear-estimate-deletes-note.test.ts
tests/unit/f060-discipline-estimate-schema.test.tsx
tests/integration/f017-new-discipline-estimates.test.ts

## Commands run
`grep -rn "setDisciplineEstimate\b|clearDisciplineEstimate\b" --include="*.ts" --include="*.tsx"` (found only estimates.ts itself, the barrel, and 4 test files — no product-code callers)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 7 pre-existing unrelated warnings)
`npm test -- tests/unit/f020 tests/unit/f060` (0 — 20/20 passed)
`npm test -- tests/unit/f023` (0 — file deleted, 2 unrelated files matching the glob passed)
`npm test -- tests/unit/f021 tests/unit/f022-atomicity-bulk-estimates tests/integration/f017` (0 — all relevant suites passed; f017-new-discipline-estimates is `describe.skip`-guarded, only typechecked)
`npm test` (full suite; 4462 passed / 225 failed / 1695 skipped — the 225 failures are pre-existing, reproduced identically on `main` before this change via `git stash`; none touch discipline-estimate code. Verified failure count/composition is unchanged by this feature's diff.)

## Decisions made
- Grepped first and found `setDisciplineEstimate`/`clearDisciplineEstimate` had no product-code callers outside `estimates.ts` and the barrel — only test files referenced them (f023 tautology test, f020's clear-note test, f060's write-path unit tests, and f017's `describe.skip`-guarded integration test). Removing the functions required updating all four test files, not just f023/f020 as literally listed in the task, because f060 and f017 also called the removed functions directly and would otherwise fail to typecheck/import.
- f060: converted the four write-path tests (`AS-060/061/062` + invalid-discipline case) from `setDisciplineEstimate(taskId, discipline, input, note)` to `setDisciplineEstimatesBulk(taskId, [{discipline, input, note}])`, adjusting the upsert-payload assertions to expect an array (bulk always sends `upsert(rows: array, options)`), and added the `@/lib/activity/audit` mock + `supabase` field on the `getCurrentUser` mock that the bulk action's audit-log call requires (following the pattern already established in f021/f022's bulk tests).
- f017 (`describe.skip`-guarded, never executes but must typecheck): same swap from singular calls to `setDisciplineEstimatesBulk(taskId, [{...}])` for all five it-blocks, preserving the existing seed/read-back assertions.
- f023: deleted outright rather than rewriting to "assert NOT exported" — the file's entire premise (a decision record for keeping the singular actions) is void now that F073/this feature reversed that decision; a fresh decision-record test would just be duplicate ceremony over what F075/AS-082 already covers.
- f020: fully rewrote per the task's explicit instruction. AS-074 ("clearing an estimate also clears its note") is now proven via the bulk path: an empty-string `input` entry produces an upsert row with `minutes: null, note: null` in the same statement as any other entries — there's no separate delete step anymore, so the old delete-based mock/assertions were removed entirely rather than adapted. Simplified to one focused test (previously 7 tests covering auth/membership/permission/invalid-discipline edge cases that are already covered for the bulk path by f021/f022/f076) to avoid duplicating coverage that already exists for `setDisciplineEstimatesBulk`'s validation/auth chain.
- Left `setDisciplineEstimateSchema` / `clearDisciplineEstimateSchema` exported from `lib/validation/architecture.ts` untouched — they are still used by `lib/validation/architecture.test.ts` and `tests/unit/f060-discipline-estimate-schema.test.tsx` for pure schema-validation assertions unrelated to the removed actions, and the task scope was limited to the action functions, not their schemas.

## Out-of-scope work needed
None identified. The removal is self-contained; no other module imported the singular actions.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Updated tests/unit/f060-discipline-estimate-schema.test.tsx and tests/integration/f017-new-discipline-estimates.test.ts (not explicitly named in the task) because they called the now-removed functions directly; leaving them unchanged would have broken typecheck/imports. Converted their write-path assertions to the equivalent `setDisciplineEstimatesBulk` single-entry call, preserving the original assertion intent (AS-060/061/062 per-discipline round trip).
AUTONOMOUS_DECISION: Deleted tests/unit/f023-singular-actions-decision.test.ts rather than rewriting it to assert non-export, per the task's stated "either is fine" — since the whole point of the file was recording a decision that no longer holds, a clean deletion is less confusing for future readers than a test that awkwardly asserts an absence.

## Notes for the next worker
No MCP tools were needed for this feature — pure in-repo action/test refactor, no live schema or external service touched.
