# Handoff: F113 — Fix AS-130 barrel hardening (whole-source export check)

## Status
COMPLETE

## Assertions covered
AS-130: PASS — `tests/unit/m6-action-barrel-guard.test.ts` (2 tests) pass on clean HEAD; mutation proofs below confirm the guard now hard-fails on multi-line/inline disallowed exports that the old line-by-line scan missed.

## Files changed
tests/unit/m6-action-barrel-guard.test.ts

## Commands run
`npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (0, clean HEAD, 2 passed)
`npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (1, mutation proof 1 — async function export appended)
`npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (1, mutation proof 2 — multi-line bare export block appended)
`git checkout -- lib/actions/architecture.ts` (0, after each mutation)
`git diff --stat lib/actions/architecture.ts` (0, empty after each revert)
`npx vitest run tests/unit` (1 overall — 9 pre-existing unrelated failing files, all failures are in unrelated realtime/rpc-mocking tests, not touched by this feature)

## Decisions made
- Kept the existing single-scan comment/string tokenizer (`scanSource`/`stripComments`/`stripCommentsAndStrings`) unchanged — it already correctly handles the comment/string edge cases called out in its own doc comment. Only `parseBarrelExports` needed to change.
- Extraction of `export { a, b } from "..."` and `export type { ... } from "..."` re-export blocks now happens against the whole `stripComments(source)` string (not per-line) via global regex, exactly as before, since these forms were already correctly multi-line-safe (regex has no `^`/`$` anchors and `[^}]*` spans newlines).
- After collecting and removing recognized re-export blocks (value and type-only) from the stripped source, the remainder is passed through `stripCommentsAndStrings` again and searched for any leftover `\bexport\b`. Any match (export*, export default, a bare `export { ... }` without `from`, or an inline `export function`/`export async function`/`export const` declaration — single- or multi-line) triggers `expect.fail` with the offending line's context extracted via `[^\n]*\bexport\b[^\n]*`.
- Did not need special-case handling for `"use server"` — it contains no `export` keyword so it passes through untouched; confirmed via clean-HEAD pass (barrel currently has a `"use server"` directive per repo convention).

## Out-of-scope work needed
Pre-existing failures in `tests/unit` unrelated to this feature (found while running the full unit suite as a sanity check, NOT caused by this change):
- `tests/unit/personal-todo-list-realtime-wiring.test.tsx` and `tests/unit/undo-toast.test.tsx` — `TypeError: Cannot read properties of undefined (reading 'getSession')` in `lib/realtime/subscribe-when-authenticated.ts:44`, suggests a Supabase auth client mock is missing/stale in those test files.
- `tests/unit/watching-feed-query.test.ts` — `TypeError: supabase.rpc is not a function`, suggests the Supabase client mock used there doesn't stub `.rpc`.
These are unrelated to `lib/actions/architecture.ts` or the barrel guard and were failing before this change (not introduced by it). A future feature should investigate and fix these mocks.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `[^\n]*\bexport\b[^\n]*` (single-line context around the match) for the failure message context even though the offending construct may itself span multiple lines (e.g. the multi-line `export {\n  zombieMultiline,\n};` case) — the reported context is just the first line containing the leftover `export` keyword, which is sufficient to point a developer at the problem without needing multi-line context in the assertion message.

## Notes for the next worker
- Ran the full `tests/unit` suite (not just this feature's test file) as an extra sanity check beyond what the spec required, to confirm no regression was introduced. It surfaced 9 pre-existing unrelated failing test files (see Out-of-scope section) — these existed independently of this change and are not part of AS-130's scope.
- Mutation proof 1 (async function export) output: `AssertionError: barrel has a disallowed export the guard cannot enumerate (export*, export default, a bare export without "from", or an inline declaration export): export async function zombieAction() { return null; }`
- Mutation proof 2 (multi-line bare export block) output: `AssertionError: barrel has a disallowed export the guard cannot enumerate (export*, export default, a bare export without "from", or an inline declaration export): export {`
- Both mutations were reverted via `git checkout -- lib/actions/architecture.ts` and confirmed clean via `git diff --stat`.
