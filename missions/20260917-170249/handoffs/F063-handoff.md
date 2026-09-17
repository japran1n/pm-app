# Handoff: F063 — FU-M2-21/22/23 longhand final fix (pass-through allow-list, extra shorthands, empty-value guards)

## Status
COMPLETE

## Assertions covered
AS-069: PASS — dispatch/pass-through/warn-and-drop behavior all verified via `expandDeclaration` tests including the new PASS_THROUGH and EXTRA_SHORTHANDS tests; full longhand.test.ts suite green.
AS-076: PASS — `css.test.ts` "other background-* longhand properties on the same class are unaffected by the presence of background-image" now passes; `background-position`/`background-size` no longer warn-and-dropped.
AS-055: PASS — existing border expansion tests unaffected/still green (no regression from default-branch restructure).
AS-062: PASS — flex-flow unknown token ("extra") now warns and is skipped instead of overwriting flex-direction; verified via new test and manual `parseCss('.x{flex-flow:wrap row extra}')` check matching the definition-of-done example exactly.
AS-066: PASS — list-style unknown token ("foo", "bar" after type already set) now warns and is skipped instead of overwriting list-style-type; verified via new test.
AS-135: PASS — reviewed longhand.test.ts; all existing test labels (AS-053..AS-069) match their tested behaviour, no mislabels found in this file (prior F062/F065 already cleaned css.test.ts/breakpoints.test.ts). New tests added use accurate labels.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/longhand.test.ts` (0)
`npx vitest run lib/webflow-converter/` (0) — 213/213 passed across all 4 test files
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Added `PASS_THROUGH` (exported) and `EXTRA_SHORTHANDS` sets exactly as specified in the feature spec, checked in `expandDeclaration`'s default branch before the existing `isShorthand`/`shorthandProperties` checks, so pass-through properties are never intercepted by the shorthand vocabulary lookup even though `css-shorthand-properties` itself considers `background-position`, `grid-row`, `grid-column`, `grid-area` to be shorthands.
- Exported `PASS_THROUGH` from longhand.ts (was originally module-private in the spec's suggested code) so the two "independent vocabulary" tests in longhand.test.ts (`test_AS_069_independent_vocabulary_every_known_shorthand_expands_to_empty_decls_with_warning` and `test_AS_069_unsupported_shorthands_from_independent_vocabulary_are_dropped_with_warning`) could be updated to skip PASS_THROUGH properties rather than asserting they get dropped — those two tests were written under the old (bug) assumption that every css-shorthand-properties-vocab property must warn-and-drop, which directly contradicted the pass-through requirement. Updated them in place to filter `PASS_THROUGH` properties out of their iteration, keeping their original intent (every non-pass-through vocab property must warn-and-drop) intact.
- flex-flow: replaced the `else` fallback (which unconditionally wrote unrecognized tokens into `flex-direction`) with an explicit direction-keyword regex; anything matching neither wrap nor direction regex now pushes a warning and is skipped, never assigned.
- list-style: replaced the `else` fallback (which unconditionally overwrote `list-style-type` on every unrecognized token) with a guard that only sets `list-style-type` once (first unrecognized/type-shaped token); subsequent unrecognized tokens warn instead of overwriting.
- Added `if (!v) return { decls: {}, warning: ... }` guards to gap, overflow, place-items, place-content, place-self, flex, and transition — mirroring the existing border-radius empty-value guard — so empty/whitespace-only values never produce `undefined` values in `decls`.
- Did not find any AS-057/AS-039-style mislabeled tests inside `longhand.test.ts` itself (all `describe`/`it` blocks in this file already carry accurate AS- labels matching their assertions) — the scrutiny's AS-135 mislabel findings referenced by prior milestones were in `css.test.ts` and `breakpoints.test.ts`, already fixed by F062/F065. Recorded this explicitly since Fix 7 in the spec asked to search this file specifically.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Exported `PASS_THROUGH` from longhand.ts (spec's suggested snippet had it as a private const) purely so the two pre-existing "independent vocabulary" tests could be corrected without duplicating the set's contents in the test file — this keeps the allow-list as a single source of truth.
AUTONOMOUS_DECISION: Did not delete a tautological test named `test_AS_069_parseCss_never_surfaces_a_shorthand_key_in_base_or_variant_buckets` per Fix 3's instruction — grepped longhand.test.ts and the whole repo and found no test by that name; it appears to have already been removed or renamed in a prior worker pass (F062/F065). No action needed.

## Notes for the next worker
- The `css-shorthand-properties` npm package's vocabulary (`shorthandProperties` export) considers `background-position`, `background-size` (partially), `grid-row`, `grid-column`, and `grid-area` to be shorthand properties even though Webflow accepts them natively as plain declarations — this is exactly the class of false positive PASS_THROUGH exists to correct. If future work expands PASS_THROUGH, remember the two "independent vocabulary" tests in longhand.test.ts filter on `PASS_THROUGH` and will automatically exempt any newly added property.
- Verified definition-of-done examples manually via `npx tsx -e "..."` calling `parseCss` directly (not just unit tests) for: `background-position:50% 50%` (passes through, no warning), `overscroll-behavior:contain` (warned, dropped), `border-inline-start:1px solid red` (warned, dropped), `-webkit-box-shadow:0 2px 4px red` (warned, dropped), `flex-flow:wrap row extra` (flex-wrap:'wrap', flex-direction:'row', warning mentions 'extra'), `gap:` empty (warned, dropped, no undefined values) — all matched the spec's expected output exactly.
- No MCP tools used — this is a pure library/unit-test feature with no external service touched.
