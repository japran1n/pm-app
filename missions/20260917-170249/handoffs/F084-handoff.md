# Handoff: F084 — fix pseudo-state variant mapping — placeholder slot + breakpoint+state collision (AS-041)

## Status
COMPLETE

## Assertions covered
AS-041: PASS — Added/verified tests for all 8 states named in the contract (hover, active, focus, focus-visible, visited, placeholder, before, after): hover/active/focus map to real Webflow slots (hover/pressed/focused); focus-visible/visited/placeholder/before/after correctly fall through to the "does not map to a Webflow state" warning+skip path (no crash, no wrong slot). Also added a test proving a default-breakpoint `:hover` and a `@media (max-width:991px) :hover` on the same class no longer collide — the default hover slot is preserved and the breakpoint-scoped hover declarations are folded into that breakpoint's own `styleLess` with a warning.

## Files changed
lib/webflow-converter/emit.ts
lib/webflow-converter/emit.test.ts

## Commands run
`npx vitest run lib/webflow-converter/emit.test.ts` (0) — 25 passed
`npx vitest run lib/webflow-converter/` (0) — 359 passed (full converter suite, no regressions)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Removed `placeholder: "nthChild"` from `PSEUDO_STATE_TO_WEBFLOW` entirely rather than pointing it at a different real slot — per spec, Webflow has no dedicated placeholder slot, so it must fall through to the existing warning+skip path (same as `:visited`, `::before`, `::after`, `:focus-visible`).
- For the breakpoint+state collision fix, detected composite keys whose prefix (before the first `_`) is a real breakpoint name (`medium`, `small`, `tiny`, `large`, `xl`, `xxl`) AND whose suffix maps to a real Webflow state slot. Only those are redirected into the breakpoint's `styleLess`. The default breakpoint's composite keys are `main_<state>` (per `breakpoints.ts`'s `variantKey()`), and `"main"` is deliberately not in `BREAKPOINT_VARIANT_KEYS`, so `main_hover` still routes to the top-level `hover` slot as before — this preserves the passing `test_AS_041_hover_pseudo_state_variant_maps_onto_webflow_hover_slot` test unchanged.
- Declarations for a breakpoint+state collision are appended (space-joined) to any existing `styleLess` for that breakpoint, rather than overwritten, so a plain `@media (...) { .card { color: blue } }` rule and a `@media (...) { .card:hover { color: green } }` rule on the same breakpoint both survive in the same `styleLess` string.
- Warning message for the collision case explicitly names the state and says "declarations moved to breakpoint styles", per the spec's exact wording requirement.
- Left the `nthChild` key in the `WebflowStyleVariants` interface even though nothing populates it anymore — the interface is shared clipboard-shape typing and spec said not to touch schema/slots beyond removing the bad mapping; leaving an unused optional field is harmless and avoids scope creep into the type surface other features may depend on.

## Out-of-scope work needed
None identified within this feature's boundary. Did not touch convert.ts or validator.ts as instructed (convert.ts shows as modified in git status from a concurrent worker's session — left untouched and unstaged).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "AS-041 lists exactly 8 states... any state not in that list gets a warning + skip" as referring to the 8 states `parseCss`/`STATE_ALIASES` in css.ts recognizes as valid pseudo-selectors (not rejected as "not a plain class selector"). Among those 8, only 3 map to real Webflow variant slots today (hover, active→pressed, focus→focused); the other 5 (focus-visible, visited, placeholder, before, after) correctly warn+skip in emit.ts. This matches the feature spec's explicit list of tests to add and the existing pre-fix behavior for visited/before/after/focus-visible (only placeholder was wrongly mapped).

## Notes for the next worker
- `lib/webflow-converter/breakpoints.ts`'s `variantKey(breakpoint, state)` produces `"main_hover"` for a default-breakpoint `:hover` (not bare `"hover"`) — this is why the collision-detection code checks whether the underscore-prefix is a member of `BREAKPOINT_VARIANT_KEYS` (which excludes `"main"`) rather than just checking for an underscore.
- No MCP tools were needed for this feature — pure local TypeScript logic, no external service state involved.
