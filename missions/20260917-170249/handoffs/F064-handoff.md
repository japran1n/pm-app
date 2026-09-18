# Handoff: F064 — Fix: reject media-type + condition combos in mapBreakpoint

## Status
COMPLETE

## Assertions covered
AS-048: PASS — added tests for media-type-prefixed queries (`print and (max-width:767px)`, `tv and (max-width:479px)`, `screen and (max-width:991px)`) and width+non-width-feature compounds (`(max-width:767px) and (orientation:landscape)`), all return null. Existing AS-048 null cases still pass.

## Files changed
lib/webflow-converter/breakpoints.ts
lib/webflow-converter/breakpoints.test.ts

## Commands run
`npx vitest run lib/webflow-converter/breakpoints.test.ts` (0) — 25 passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Added a `mediaTypePattern` rejection (all/print/screen/tv/speech/handheld/projection/braille/embossed/tty) before the width-parsing logic runs, so a media-type-qualified query never falls through to the existing max-width/min-width regexes.
- Added an "only pure width condition" gate: parenthesized `(max-width:Npx)`, `(min-width:Npx)`, `(width <op> Npx)`, and the existing bare (non-parenthesized) `max-width:Npx` / `min-width:Npx` forms are the only shapes allowed through; anything else containing `and` or a known non-width feature (orientation, resolution, hover, pointer, aspect-ratio, color, monochrome, scan, grid, update, overflow-block, overflow-inline) returns null. Kept the bare (non-parenthesized) single-condition forms allowed since the pre-existing positive tests (`max-width: 991px` with no parens) depend on them and were not part of this fix's scope.
- Relabeled the two range-syntax positive-mapping tests (`(width <= 767px)` → 'small', `(width < 768px)` → 'small') from AS-048 to AS-071 since they assert a positive mapping to 767px→small, matching the existing AS-071 test's assertion, per spec instructions. Left the four already-correct AS-048 negative tests (compound min/max, negated, only-prefixed, comma-list, non-exact px, print, orientation) as-is since they already assert null.
- Did not relabel AS-070/AS-072 positive tests since they were already correctly labeled AS-070/AS-072 in the existing file (only the two range-syntax tests were mislabeled as AS-048).

## Out-of-scope work needed
None identified. The feature spec only covers the media-type/non-width-feature rejection and test relabeling.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Kept bare (non-parenthesized) `max-width:Npx` / `min-width:Npx` query forms in the "allowed" set alongside the parenthesized forms, since the existing positive tests (e.g. `mapBreakpoint('max-width: 991px')` → 'medium') use the bare form with no surrounding parens, and the spec's provided regex snippets only covered parenthesized forms. Excluding bare forms would have broken pre-existing passing tests outside this feature's scope.

## Notes for the next worker
No MCP usage — pure local TypeScript logic/test fix, no external service touched.
