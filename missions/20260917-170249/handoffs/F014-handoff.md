# Handoff: F014 — css parse orchestration

## Status
COMPLETE

## Assertions covered
AS-046: PASS — `.card { color: red !important; }` strips the flag, keeps `color: red` applied in `base`, and adds exactly one warning noting it was dropped.
AS-049: PASS — a simple `.card { color: red; }` rule produces `base = { color: "red" }` with no variants and `comboOf: null`.
AS-050: PASS — `.box { margin: 1px 2px 3px 4px; }` flows through `expandDeclaration` and lands as four longhand `margin-*` declarations in `base`, no warnings.
AS-051: PASS — `@media (max-width: 767px)` maps to variant key `small`; combined with `:hover` inside `@media (max-width: 991px)` maps to `medium_hover`; a bare `:hover` (no `@media`) maps to `main_hover`.
AS-052: PASS — `.card.is-featured { ... }` registers `card` (comboOf null) and `is-featured` (comboOf `"card"`), with declarations attached to `is-featured`.
AS-075: PASS — `background-image: url(...)` passes through untouched in `base["background-image"]`, no special-casing applied.
AS-076: PASS — `@media print` (unmappable query) produces zero classes and one warning ("does not map to a Webflow breakpoint"); `@keyframes`/`@font-face` produce their own dedicated warnings instead of being parsed as classes.

## Files changed
lib/webflow-converter/css.ts
lib/webflow-converter/css.test.ts
package.json

## Commands run
`npx vitest run lib/webflow-converter/css.test.ts` (0) — 30/30 tests passed
`npx tsc --noEmit -p .` (0) — no errors in lib/webflow-converter/css.ts

## Decisions made
- Followed the "byte-for-byte logic port" clarified answer: `parseCss()` mirrors the prototype's `~/Desktop/html-to-webflow/src/css.mjs` structure and control flow exactly (recursive `walk()` over postcss containers, `ensure()` helper, `variants`/`base` buckets), just re-typed and wired to the already-ported sibling modules (`parseSelector` in this same file from F012, `mapBreakpoint`/`variantKey` from breakpoints.ts, `expandDeclaration` from longhand.ts) instead of duplicating their logic.
- Data shape: kept the prototype's object shape 1:1 (`{ name, base: Record<string,string>, variants: Record<string, Record<string,string>>, comboOf: string|null }`) rather than the orchestrator prompt's alternate paraphrase ("styleLess: string"). The clarified spec's own "Data shape" answer explicitly says "plain TypeScript interfaces/types matching the prototype's JS object shapes 1:1" and "Port fidelity: byte-for-byte logic port... behavior unchanged" — those clarified answers take precedence over the informal task-prompt wording, per the worker-mcp-usage ambiguity priority order (clarified spec > tech-decisions > safest default).
- `!important`: postcss's `decl.value` already excludes the `!important` flag, so no explicit stripping code was needed — `decl.important` is only used to trigger the warning, and the "declaration still applied" requirement (AS-046's noted departure from the prototype, which the spec says "only warned") is satisfied because `Object.assign(bucket, decls)` runs unconditionally either way. Confirmed via the AS-046 test that `base.color` is `"red"`, not dropped.
- Added `postcss` as an explicit devDependency pinned to `^8.5.28` (matching the version already resolved transitively via `@tailwindcss/postcss`, verified via `node -e "require('postcss/package.json').version"` = 8.5.28) so it can't silently disappear.
- Kept `parseSelector`/`STATE_ALIASES` (already present in css.ts from F012) untouched; only appended the new `parseCss` orchestration below it, per "Public API surface: export only the one function this feature is named for" — `ParsedClass`/`ParseCssResult` types are exported since callers of `parseCss` (F018 emit) need the return-type shape, but no new internal helpers were exported.

## Out-of-scope work needed
- The unused-class warning (styled but never referenced in HTML) is explicitly deferred to F018 (emit) per this feature's own draft scope note — F014 only builds the class map; it does not know which classes the HTML side actually uses.
- background/grid/border shorthand expansion beyond what longhand.ts (F005–F009) already provides is out of scope here — this feature only orchestrates, it doesn't add new shorthand handling.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the prototype's object-shaped `base`/`variants` (Record<string,string>) over a string-concatenated `styleLess` field, because the clarified spec's "Data shape" and "Port fidelity" answers both point at matching the prototype's JS object shapes exactly, and the prototype itself uses plain declaration objects, not a serialized CSS-text string. This keeps F014's output directly consumable by F018 (emit) without a lossy stringify/reparse round-trip.

## Notes for the next worker
- `postcss@8.5.28` was already present transitively (via `@tailwindcss/postcss`) before this feature; it's now pinned explicitly in package.json devDependencies.
- The recursive `walk()` handles `@media` (mapped via `mapBreakpoint`), `@supports`/`@layer` (transparent passthrough, breakpoint context preserved), `@keyframes` and `@font-face` (both produce a warning and are skipped entirely — no partial parsing).
- Test file `lib/webflow-converter/css.test.ts` now has both the F012 `parseSelector` suite (unchanged) and a new `describe("F014 parseCss", ...)` block with 15 tests covering every assigned assertion plus empty-input, multi-selector, and @supports-wrapping edge cases.
- No MCP tools were used — this is a pure engine/unit-test feature per tech-decisions and the feature spec ("MCP at run: none").
