# Handoff: F055 — FU-M2-5 test traceability repair

## Status
COMPLETE

## Assertions covered
AS-042: PASS — new parseCss-level test "AS-042: a descendant selector (.card h3) produces a warning and is not converted into any style" in css.test.ts
AS-043: PASS — new parseCss-level test "AS-043: an ID selector (#hero) produces a warning and is not converted into any style" in css.test.ts
AS-044: PASS — new parseCss-level test "AS-044: a combinator selector (a.btn > span) produces a warning and is not converted into any style" in css.test.ts
AS-045: PASS — new parseCss-level test "AS-045: an attribute selector ([data-x]) produces a warning and is not converted into any style" in css.test.ts
AS-049: PASS — relabelled onto the real @keyframes test "AS-049: a @keyframes block produces a warning recommending it be moved to page custom code, and is not converted into any style" in css.test.ts
AS-050: PASS — relabelled onto the real @font-face test "AS-050: a @font-face block produces a warning recommending the font be uploaded via Webflow site settings, and is not converted into any style" in css.test.ts
AS-076: PASS — relabelled off the wrong (@media print) test and onto a new test "AS-076: other background-* longhand properties on the same class are unaffected by the presence of background-image" in css.test.ts

## Files changed
lib/webflow-converter/css.test.ts
lib/webflow-converter/breakpoints.test.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 4 files, 179 tests, all passed

## Decisions made
- css.test.ts:102 ("simple class rule produces a styleLess-equivalent base declaration set") had a wrong "AS-049:" label — stripped the label since it doesn't match any single assertion text; it stays as a generally useful unlabelled orchestration test.
- css.test.ts:112 (margin shorthand flowing through parseCss) had a wrong "AS-050:" label — stripped it for the same reason.
- css.test.ts's @media print test had a wrong "AS-076:" label; relabelled it "AS-048" since its behaviour (unmappable @media query -> warning + skipped rules) matches AS-048's text, and AS-048 already has a sibling numeric-boundary test elsewhere in the same file — multiple tests per assertion ID is expected/fine.
- Split the combined "@keyframes and @font-face ... produce warnings" test into two separately labelled AS-049 / AS-050 tests (one assertion each, per the "no compound assertions" rule), and kept the original combined test (now unlabelled) since it also exercises both warnings appearing together in one warnings array.
- Added a new AS-076 test asserting background-color/background-position/background-size survive untouched alongside background-image on the same class, since no existing test covered "other background-* longhand properties... unaffected."
- breakpoints.test.ts: the `mapBreakpoint('print')` test was wrongly labelled "AS-074" (AS-074 is about the *absence* of a media query being the base style, not about an unmappable one) — relabelled to AS-048, consistent with the sibling out-of-range tests in the same describe block.
- breakpoints.test.ts: `variantKey('main', null)` returning null (meaning "no media query -> goes into base styleLess, not a variant") was wrongly labelled "AS-048" — this is exactly what AS-074 describes, so relabelled it to AS-074.
- longhand.test.ts: the font-fallback test named `test_AS_065_size_only_no_family_is_kept_as_shorthand_with_warning` already asserted the correct warn-and-drop behaviour (`decls: {}`, warning matches `/could not expand/i`) — its *name* was the mirror-test problem (implying the old "kept as shorthand" behaviour), not its assertion. Renamed to `test_AS_065_size_only_no_family_is_warned_and_dropped_not_kept_as_shorthand` and added an explicit `not.toHaveProperty('font')` check to make the drop-not-keep intent unmissable. No other mirror tests were found needing inversion — the flex:initial-drop and var()-as-border-color tests referenced in the follow-up scope already asserted the post-F051/F052 behaviour correctly at the current line numbers; only names/labels were stale or absent.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For the two css.test.ts tests whose wrong AS-ID labels didn't correspond to any single correct assertion (the plain-class-rule test and the margin-shorthand-through-parseCss test), I stripped the label rather than inventing a new mapping, since no assertion in the contract describes exactly "a simple class rule with no media/pseudo produces a base decl set" or "shorthand expansion flows through parseCss" as a standalone observable behaviour distinct from AS-050/AS-053 (which are already covered elsewhere at the unit level in longhand.test.ts and the parseSelector suite).

## Notes for the next worker
No MCP usage — this is a pure local test-file repair task with no external service touched. Full-repo `npx vitest run` was started but exceeded the 120s foreground timeout (moved to background); this feature's own scoped test command (`npx vitest run lib/webflow-converter/`) completed and passed cleanly in ~220ms, which is what the DoD for this follow-up requires.
