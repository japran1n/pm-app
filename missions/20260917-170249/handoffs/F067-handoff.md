# Handoff: F067 — fu-b-c-d-e-longhand-final

## Status
COMPLETE

## Assertions covered
AS-055: PASS — parseBorderParts now classifies tokens by kind (width/style/color) instead of slot-filling by position; var()/calc() tokens drop the entire declaration with a warning; extra tokens of an already-filled kind are discarded with a warning instead of leaking into the wrong slot.
AS-069: PASS — grid-column/grid-row/grid-area removed from PASS_THROUGH (Webflow rejects the shorthand form) and now resolve via isShorthand -> warn-and-drop; white-space added to PASS_THROUGH; overflow-block/overflow-inline/scroll-margin-block/scroll-margin-inline added to EXTRA_SHORTHANDS; grid-template-areas removed from EXTRA_SHORTHANDS (Webflow accepts it natively, so it now passes as an ordinary longhand through the default branch).
AS-063: PASS — expandTransition drops an entire transition-list item (rather than defaulting duration to '0s') when a var()/calc() token appears before any real duration has been resolved for that item; a var()/calc() token appearing after a real duration was already parsed still falls back to the pre-existing "unrecognized token skipped" behavior so it doesn't wipe out an already-parsed item.
AS-065: PASS — expandFont now recognizes CSS font-stretch keywords (ultra-condensed..ultra-expanded, semi-condensed, semi-expanded, condensed, expanded, normal) in the leading-keyword loop and emits font-stretch in the output decls.
AS-135: PASS — the AS-069 independent-vocabulary test now asserts `Object.keys(shorthandProperties).length > 10` at its start, guarding against a silently-empty css-shorthand-properties import making that test vacuously pass.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/longhand.test.ts` (0) — 144 passed
`npx vitest run lib/webflow-converter/` (0) — 225 passed across 4 files
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- parseBorderParts now returns a `warnings: string[]` field instead of a bare `{width,style,color}` object. Callers (`border`, `border-top/right/bottom/left`, `outline`) were updated to surface `b.warnings` as the ExpandResult's `warning` field, and to detect the "fully dropped" case (all three of width/style/color undefined plus warnings present) so they return `{ decls: {} }` rather than emitting three keys of `undefined`-driven noise.
- For transition, only drop the *whole item* when the unparseable var()/calc() token is encountered before any real duration token (`timeSeen === 0`) for that item — this matches the spec's literal example (`opacity var(--d) ease`) while preserving the pre-existing behavior for a var() token that shows up *after* a real duration was already parsed (`opacity .2s var(--ease)` — kept as "unrecognized token skipped", not a full item drop). Dropping unconditionally on any var()/calc() token anywhere in the item would have made an already-resolved item vanish, which is not what AS-063's pre-existing test coverage (and the transition-list positional-alignment guarantee for AS-064) expects.
- Removing grid-column/grid-row/grid-area from PASS_THROUGH and dropping var()/calc() in the border/outline classifier both invalidated a handful of pre-existing tests that encoded the *old* (buggy) behavior the feature spec explicitly asks to fix. I updated those specific tests in place to assert the new, correct behavior (documented inline with comments referencing F067), rather than leaving contradictory assertions in the suite. Specifically: `test_AS_055_color_style_width_in_declaration_order`, `test_AS_055_bare_var_token_goes_to_color_not_width`, `test_AS_055_bare_calc_token_goes_to_color_not_width`, `test_AS_067_bare_var_token_goes_to_color_not_width`, and `AS-069: PASS_THROUGH longhands survive expandDeclaration` (grid-row/grid-column removed from that list, replaced with a new test asserting they are now caught as shorthands).
- white-space was added to PASS_THROUGH per the spec's explicit final instruction (not EXTRA_SHORTHANDS), since Webflow's style panel accepts white-space directly even though CSS4 nominally treats it as shorthand for white-space-collapse/text-wrap-mode.

## Out-of-scope work needed
None identified beyond this feature's scope — F067 was itself a longhand/hardening follow-up; no further gaps observed in the box/border/font/transition expanders during this pass.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Updated 5 pre-existing tests that directly encoded the old (pre-F067) buggy behavior the spec asked me to fix (var()-as-color slot-filling, grid-*-as-pass-through). These are not new assertions — they're existing AS-055/AS-067/AS-069 tests whose expected `decls` were tied to the specific classification bug being fixed, so leaving them unchanged would make the suite self-contradictory (impossible to satisfy both the old and new specified behavior simultaneously). Documented each with an inline comment pointing at F067.
AUTONOMOUS_DECISION: For the AS-063 transition duration-drop rule, scoped the drop to "no real duration parsed yet" for that item (timeSeen === 0) rather than "any var()/calc() token anywhere in the item," since the latter would silently break the AS-064 positional-alignment guarantee and an already-passing regression test for a var() token appearing after a real duration.

## Notes for the next worker
- `Object.keys(shorthandProperties).length` from the `css-shorthand-properties` npm package was confirmed to be well over 10 in this run (170+ typically), so the new AS-135 guard is not vacuous in practice — it exists to catch a future broken/empty import.
- No MCP tools were used — this is a pure, isolated TypeScript module with no external service dependency.
