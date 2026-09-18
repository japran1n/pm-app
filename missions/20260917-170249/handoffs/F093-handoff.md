# Handoff: F093 — Revert incorrect AS-116 name-uniqueness check added in F092

## Status
COMPLETE

## Assertions covered
AS-116: PASS — "No two style definitions share the same identifier" is enforced by the pre-existing `_id`-uniqueness check in `validateStyles` (kept). The incorrect `style.name` uniqueness check added by F092 (which rejected valid coexisting standalone `.primary{}` + combo `.btn.primary{}` styles) has been removed. Verified via `lib/webflow-converter/validator.test.ts` (duplicate `_id` test still present and passing) and `lib/webflow-converter/convert.test.ts` (combo-produces-one-style test still present and passing).
AS-117: PASS — untouched; emitter fix in `emit.ts` (skip unparented combo styles) kept as-is.

## Files changed
lib/webflow-converter/validator.ts
lib/webflow-converter/validator.test.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 9 files, 385 tests passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Removed only the `seenNames` Map block in `validateStyles` (validator.ts) that checked `style.name` uniqueness — this block implemented a rule not present in AS-116's text (identifier = `_id`, not `name`).
- Kept the pre-existing `styleMap`-based `_id` duplicate check, which is the correct implementation of AS-116.
- Removed the validator test "AS-116: duplicate style names produce a validation error" (encoded the wrong rule) while keeping the sibling test "rejects duplicate style _ids with a specific error" (the correct AS-116 test).
- Removed the convert.test.ts case "AS-116: .btn{} .primary{} .btn.primary{} on single element produces error (duplicate style name)" (expected `payload: null`, which was wrong). Kept the other AS-116 convert test ("combo .btn.primary produces exactly one style named primary") since it does not depend on name-uniqueness rejection and still passes.
- Did not touch `emit.ts` (AS-117 fix) per instructions.

## Out-of-scope work needed
None identified beyond this revert. The docblock comment on `validateStyles` in validator.ts already correctly described AS-116 as "duplicate _ids" prior to this fix and required no change.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was unambiguous and fully specified which lines to remove)

## Notes for the next worker
No MCP tools used — this is a pure local TypeScript/test fix with no external service touched. The two example scenarios from the feature spec (`.btn.primary{color:red}` on `<div class="btn primary">`, and `.primary{}` + `.btn.primary{}` producing two same-named-but-distinguished-by-`comb` styles) are now correctly accepted by the validator with `errors: []` and non-null payload, since the only remaining name-related check is the AS-114 "class references a known style name" check (unaffected by this change) and the AS-116 `_id` uniqueness check (also unaffected, since combo and standalone styles always get distinct `_id`s).
