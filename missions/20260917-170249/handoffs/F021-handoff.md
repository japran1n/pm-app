# Handoff: F021 — convert orchestrator

## Status
COMPLETE

## Assertions covered
AS-120: PASS — convert() wires parseCss + emitWebflow + extractScripts/extractStyles + validatePayload into one call; verified via "converts simple HTML + CSS" and "converts HTML only" tests.
AS-129: PASS — module only imports sibling pure modules (css.ts, emit.ts, js-extract.ts, validator.ts); no database, fs, or network calls. Verified by code review and the AS-011 grep test (no Supabase imports anywhere in lib/webflow-converter).
AS-141: PASS — nested combo-class HTML/CSS input produces zero validator errors; covered by the "extracts scripts and styles" and "de-duplicates warnings" tests plus the success-path test with nested `.a` combo classes.

## Files changed
lib/webflow-converter/convert.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx vitest run lib/webflow-converter/convert.test.ts` (0) — 10/10 tests passed
`npx vitest run lib/webflow-converter/` (0) — 329/329 tests passed (full converter suite, no regressions)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- `convert(html, css)` takes the two raw source strings directly (not a combined "source" string) per the spec's explicit signature `convert(html: string, css: string): ConvertResult`, matching F021's own spec body over the older draft-scope line that described a single `source` argument — the clarified spec section supersedes the draft.
- Warnings from CSS parsing, emit, script/style extraction, and validation are merged and de-duplicated via `Set` before being returned, matching the prototype's behavior called out in the draft scope.
- Empty HTML (`""`) and empty CSS (`""`) both flow through the exact same code path as populated input (no special-casing) since `parseCss("")` and `emitWebflow("", ...)` already return well-shaped empty results — this satisfies the "empty input produces an empty, not null, result of the same shape" clarified answer without extra branching.
- `convertFromSource(html)` extracts inline `<style>` blocks via `extractStyles()` and joins their text with newlines before calling `convert()`, so combo-class chains and multiple `<style>` tags in a full document all get parsed together.
- Did not attempt to synthesize a payload that fails `validatePayload` purely through `convert()`'s public HTML/CSS input, because every combination that produces well-formed classes naturally passes validation (the class-name regex, `_id` uniqueness, and known-type checks are all satisfied by anything `emitWebflow` can produce from valid HTML). Instead the null-payload/errors contract (AS-119-adjacent wiring) is covered by an invariant-style test plus reliance on validator.ts's own dedicated failure tests (already covered by F020).

## Out-of-scope work needed
None identified — this feature only wires already-built modules together per its "Depends on" line (F014, F018, F019, F020).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the two-argument `convert(html, css)` signature from the spec's "Main function" section rather than the single-`source`-string wording in the older "Draft scope" bullet, since the clarified spec section is the more specific and more recent source of truth and explicitly gives the TypeScript signature.

## Notes for the next worker
- `emitWebflow` already internally merges `cssResult.warnings` into its own `warnings` array, so `convert()` does not need to re-add `cssResult.warnings` separately — doing so would have produced harmless duplicates that the `Set` dedup step absorbs anyway, but the final code intentionally reads warnings only from `emitResult.warnings` to avoid relying on dedup for correctness.
- `convertFromSource` is a thin convenience wrapper for self-contained documents (e.g. pasting a full `<html>` page with an inline `<style>` block) — server actions calling this feature from an editor UI will most likely use `convert(html, css)` directly since the app likely keeps HTML and CSS in separate editor panes; confirm actual call site in whichever feature builds the UI/server action layer.
