# Handoff: M7 — sync Webflow property whitelist to moden.club's exact source

## Status
COMPLETE

## Assertions covered
This is a correctness/bugfix task (not tied to new AS-NNN validation-contract IDs). It touches existing behavior covered by AS-075, AS-076, AS-141 (regression tests in this repo's suite, all now passing with the corrected whitelist).
AS-075: PASS — background-image passthrough unaffected.
AS-076: PASS — updated to exercise whitelisted background-* longhands (background-color, background-clip, background-origin) since background-position/-size/-repeat/-attachment are correctly NOT in moden's whitelist (only -x/-y split forms of position are).
AS-141: PASS — updated expected node count (7→6): margin-left/right now have no value restriction under moden's rules, so `margin: 0 auto` stays in styleLess instead of being routed to a CSS embed.

## Files changed
lib/webflow-converter/webflow-properties.ts
lib/webflow-converter/webflow-properties.test.ts
lib/webflow-converter/longhand.test.ts
lib/webflow-converter/section-embeds.test.ts
lib/webflow-converter/css.test.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run lib/webflow-converter/ components/webflow-tool/` (0) — 19 files, 531 tests passed

## Decisions made
- Replaced `WEBFLOW_SUPPORTED_PROPS` with the exact ~330-property whitelist supplied in the mission task (moden.club's reverse-engineered source).
- Replaced the ad-hoc value validators (`WEBFLOW_DISPLAY_VALUES`, `WEBFLOW_ALIGN_VALUES`, `WEBFLOW_UNIT_ONLY_PROPS`) with the exact `WEBFLOW_VALUE_CONSTRAINTS` map from the task. Properties not present in that map now accept any value — this is a behavior change from the previous (overly aggressive) implementation, which blocked `margin-top: auto`, `flex-grow`, etc. with no basis in Webflow's real behavior.
- Re-added `text-decoration` to the whitelist (was previously incorrectly removed) with its own restricted value set (`none`, `underline`, `overline`, `line-through`) per moden's `WEBFLOW_VALUE_CONSTRAINTS`.
- `isWebflowSupportedValue` public signature unchanged (still `(prop, value) => boolean`); only its internal rule table changed, so no call sites in `css.ts` / `longhand.ts` needed edits.
- Updated `webflow-properties.test.ts` per the task's exact instructions: `display: inline-flex` now valid, `display: table` invalid, `margin-top: auto` valid, `flex-basis: auto` valid, `flex-basis: 100px` invalid, `text-decoration: none` valid, `text-decoration: blink` invalid.
- Several *other* test files in `lib/webflow-converter/` used properties like `grid-template-columns`, `grid-template-rows`, `text-decoration-color`, and `aspect-ratio` as their canonical "example of an unsupported property." Under moden's exact whitelist these ARE supported (they were previously excluded by the repo's earlier — incorrect — narrower whitelist). I updated those tests to use genuinely-unsupported properties instead (`background-attachment`, `background-position`, `background-size`, `background-repeat` — none of which appear in moden's whitelist; only the split `background-position-x`/`-y` forms do) so the tests still validate the real "unsupported property is routed to CSS embed" behavior rather than asserting something now false.
- `css.test.ts` AS-076 and `convert.test.ts` AS-141 encoded assumptions from the old (wrong) whitelist/value-constraint tables. AS-076 was rewritten to use whitelisted background-* longhands (background-color/-clip/-origin) instead of background-position/-size, which are legitimately unsupported under moden's rules. AS-141's expected node count dropped from 7 to 6 because `margin: 0 auto` is now representable in styleLess (margin-left/-right have no value restriction in moden's rules, unlike the previous implementation's blanket "auto is invalid for unit-only props" rule).

## Out-of-scope work needed
None identified — this was a self-contained correction to the whitelist/value-constraint tables and their direct test dependents.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Where existing (out-of-file) tests encoded assumptions from the prior incorrect whitelist (grid-template-*, aspect-ratio, text-decoration-color now legitimately supported; background-position/-size/-repeat/-attachment now legitimately unsupported; margin auto now legitimately valid), I updated those tests to reflect moden's exact rules rather than leaving them red or reverting the whitelist. This follows directly from the task's explicit instruction to implement moden's exact rules and the general rule "tests must derive from the assertion text" — the underlying assertions (AS-075/076/141) describe end-to-end conversion behavior, not the specific property names used as fixtures, so swapping fixture properties preserves assertion intent while making expectations accurate.

## Notes for the next worker
- The full, exact moden.club property whitelist and value-constraint table now live verbatim in `lib/webflow-converter/webflow-properties.ts`. Any future property/value additions should be cross-checked against moden's source rather than reasoned about from first principles — this file's git history shows two prior rounds of incorrect, "too aggressive" fixes that this task corrected.
- `background-position-x` / `background-position-y` are whitelisted individually; the shorthand-ish `background-position` is not. Same split pattern does not apply to `background-size`/`-repeat`/`-attachment` — those have no supported form at all in moden's table.
