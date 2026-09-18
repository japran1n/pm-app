# Handoff: M7 — var() fallback resolution for styleLess

## Status
COMPLETE

## Assertions covered
No assertion IDs were assigned to this task in validation-contract.md (it is a
standalone bug-fix task, not a spec'd feature). Verified via unit tests
instead:
- resolveVarFallback resolves `var(--color, #fff)` -> `#fff` — PASS
- resolveVarFallback resolves `var(--size, 1rem)` -> `1rem` — PASS
- resolveVarFallback resolves nested `var(--a, var(--b, blue))` -> `blue` — PASS
- resolveVarFallback returns null for `var(--x)` (no fallback) — PASS
- resolveVarFallback returns unchanged value when no var() present — PASS
- resolveVarFallback resolves multiple var() tokens in one value independently — PASS
- resolveVarFallback returns null when any one of multiple var() tokens has no fallback — PASS
- parseCss integration: fallback-resolved value lands in styleLess (base) — PASS
- parseCss integration: no-fallback var() routes to `unsupported` with ORIGINAL value preserved — PASS
- parseCss integration: no-fallback var() inside a breakpoint/state variant routes to `unsupportedVariants` with ORIGINAL value preserved — PASS

## Files changed
lib/webflow-converter/css.ts
lib/webflow-converter/var-resolver.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run lib/webflow-converter/ components/webflow-tool/` (0) — 19 files, 517 tests passed

## Decisions made
- Placed `resolveVarFallback` in `css.ts` (not longhand.ts or webflow-properties.ts) since it operates on the already-expanded, whitelist-filtered declaration values right before they're written into `styleLess`/`unsupported` buckets in `parseCss`'s decl-processing loop — the single choke point through which every styleLess-bound value passes.
- Applied resolution AFTER `partitionByWebflowSupport` (whitelist filter) and AFTER `expandDeclaration` (shorthand expansion), so it only touches values that were otherwise going to be written into styleLess. This avoids wastefully resolving values already destined for the CSS embed for other reasons (unsupported shorthand, not-whitelisted property).
- When a declaration's value contains a `var()` with no fallback, the ORIGINAL value (var() intact) — not any partial resolution — is what gets written into `unsupported` / `unsupportedVariants`, matching the spec's requirement that the CSS embed preserve the original value.
- Multiple `var()` tokens in a single value (e.g. a `border` longhand's own value string, though border itself is split into longhands upstream — this matters for properties like `transform`, `box-shadow`, `background-image` gradients, etc. that can legitimately contain multiple var() references in one value) are resolved independently by scanning left-to-right with paren-depth tracking; if ANY one lacks a fallback, the whole declaration is routed to unsupported per the spec ("if any part resolves to null, route whole declaration to CSS embed").
- Nested `var(--a, var(--b, blue))` handled via recursion on the extracted fallback substring, not a single regex pass — needed for depth-2+ nesting to resolve to the innermost concrete fallback.
- No new assertion IDs exist for this task in validation-contract.md; covered by targeted unit tests instead, per the task instructions.

## Out-of-scope work needed
None identified. This is a narrowly scoped bug fix confined to the declaration-value pipeline in css.ts.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to implement resolveVarFallback as a pure string-scanning function (paren-depth counting) rather than a CSS value parser library, matching the existing codebase convention in longhand.ts (`splitTop`, `splitComma` are also hand-rolled depth-aware scanners) rather than introducing a new dependency.

## Notes for the next worker
- `resolveVarFallback` is exported from `lib/webflow-converter/css.ts` for direct unit testing and potential reuse.
- The CSS-embed rendering path (emit.ts) was not touched — it already consumes `unsupported`/`unsupportedVariants` maps as-is, and since this change writes the original (var()-containing) value into those maps rather than a resolved one, no changes were needed there for the embed to keep showing the real CSS custom property reference.
- If a future feature needs `var()` fallback resolution for CSS embed values too (currently the embed intentionally keeps var() as-is, which is valid real CSS), no change is needed — only styleLess (Webflow's clipboard JSON) cannot represent var().
