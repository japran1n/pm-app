# Handoff: F060 — FU-M2-14 through 19 longhand fixes

## Status
COMPLETE

## Assertions covered
AS-069: PASS — expandDeclaration never emits a shorthand key verbatim, verified against the independent `css-shorthand-properties` package corpus (not derived from longhand.ts's own SHORTHANDS set), including vendor-prefixed shorthands.
AS-055: PASS — `border: 0` now expands to `border-*-width: '0'` on all sides (unitless zero recognized as a width, not misclassified as color).
AS-067: PASS — `outline: 0` expands to `outline-width: '0'`; `outline: 2px auto -webkit-focus-ring-color` expands with `outline-style: 'auto'`.
AS-063: PASS — `transition: opacity .2s var(--ease)` keeps `transition-property: 'opacity'` and returns a warning naming the skipped `var(--ease)` token instead of overwriting the property.
AS-065: PASS — `font: 16px / 1.5 Arial` normalizes the spaced slash; `font: 1000 14px Inter` accepts CSS4 weight 1000; `font: small-caps 16px Inter` sets `font-variant: small-caps`; `font: caption` (and other system-font keywords) returns empty decls with a warning instead of attempting to expand.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts
package.json
package-lock.json

## Commands run
`npm install css-shorthand-properties` (0)
`npx vitest run lib/webflow-converter/longhand.test.ts` (0) — 128 passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- `css-shorthand-properties` has no bundled TypeScript types. Rather than adding a new `.d.ts` file (out of the stated file scope for this feature), I typed the `require()` result inline with a narrow local interface and disabled `@typescript-eslint/no-require-imports` on just that line — this keeps all changes inside longhand.ts/longhand.test.ts as instructed.
- Outline recognizes `auto` as a style keyword via a new `OUTLINE_STYLES` set (`BORDER_STYLES` + `'auto'`) passed into `parseBorderParts`, rather than adding `auto` to the shared `BORDER_STYLES` set — `border: auto` is not valid CSS, so keeping the sets separate avoids a false positive there.
- For AS-069, the corpus test iterates `Object.keys(shorthandProperties)` from the installed package and asserts `expandDeclaration` never returns the property key in `result.decls` verbatim — this is independent of longhand.ts's own `SHORTHANDS` set (the previous test derived its corpus from `isShorthand`, which was tautological). A second test walks the same corpus, subtracts the properties longhand.ts has real expanders for, and asserts every remaining property is warned-and-dropped with empty decls. A third test checks vendor-prefixed variants (`-webkit-transition` etc.) are also dropped via the new `stripVendorPrefix` + `bare in shorthandProperties` check in the default branch.
- `expandTransition` now returns an `ExpandResult` (decls + optional warning) instead of a bare decls object, so unknown/unhandled tokens (a second bare word, or any `var(...)` token) can surface a warning rather than silently overwriting `transition-property`.
- `expandFont` now returns `ExpandResult | null` instead of `Record<string,string> | null`, to carry the system-font-keyword warning through the same return shape as the shorthand's other early-exit paths.
- Deleted the old tautological parseCss-based AS-069 test that only checked `isShorthand(key)` over `parseCss` output — that test would always pass as long as isShorthand and expandDeclaration agreed with each other, telling us nothing about whether the vocabulary itself was correct.

## Out-of-scope work needed
None identified within this feature's scope — border/background/grid remain intentionally unimplemented shorthands per the file's original module comment, and this feature did not touch them beyond the AS-069 default-branch vocabulary check.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `require()` with an inline TypeScript interface for the untyped `css-shorthand-properties` import instead of creating a separate ambient `.d.ts` declaration file, to honor the "all in longhand.ts and longhand.test.ts only" scope constraint in the spec while still satisfying `tsc --noEmit`.
AUTONOMOUS_DECISION: Kept `outline`'s recognition of `auto` scoped to a new `OUTLINE_STYLES` set rather than adding `auto` to the shared `BORDER_STYLES` set, since `border-style: auto` is not valid CSS and the shared set feeds `parseBorderParts` used by both `border` and `outline`.

## Notes for the next worker
- `css-shorthand-properties`'s named export `isShorthand` could replace this repo's own `isShorthand`/`SHORTHANDS` entirely in a future cleanup, but that was out of scope here — the spec asked only to use the package as an independent test vocabulary, not to replace the hand-maintained `SHORTHANDS` set.
- The package's `shorthandProperties` export is an object whose keys are the shorthand property names (not an array) — `Object.keys(shorthandProperties)` is the corpus.
