# Handoff: F066 — Fix A-screen media fix

## Status
COMPLETE

## Assertions covered
AS-048: PASS — `mapBreakpoint('screen and (max-width:991px)')` now returns `'medium'` (was incorrectly `null` after F064's over-correction); non-screen media types (print, tv, etc.) and truly unmappable widths still correctly return `null`.

## Files changed
lib/webflow-converter/breakpoints.ts
lib/webflow-converter/breakpoints.test.ts
lib/webflow-converter/css.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 218 tests passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Implemented the prefix strip as the very first step in `mapBreakpoint`, via a single regex `^(?:only\s+)?(?:screen|all)\s+and\s+` (case-insensitive), matching the four required prefixes: `only screen and `, `screen and `, `only all and `, `all and `.
- After stripping, the existing `only` rejection check still applies to any query where `only` was NOT followed by `screen`/`all` (e.g. `only print and (...)`), which correctly still returns null.
- Removed `screen` and `all` from the "reject media types" regex (they're now handled by the strip step above); kept `print, tv, speech, handheld, projection, braille, embossed, tty` in that rejection list per spec.
- Updated the pre-existing F064 test asserting `screen and (max-width:991px)` → `null` to now assert `'medium'`, since this was the exact over-correction this feature fixes.
- Updated the "only prefixed query returns null" test to use `only print and (...)` instead of `only screen and (...)`, since the latter is now a valid, mappable query.
- Added new passing tests for `screen and`, `only screen and`, and `all and` prefixes across small/medium/tiny breakpoints, plus a negative test confirming `print and (...)` still returns null.
- Added an end-to-end `parseCss` test in css.test.ts confirming a full `@media screen and (max-width: 991px) { .a { color: red } }` rule correctly lands in `a.variants.medium`.

## Out-of-scope work needed
None identified — this was a narrowly scoped regex fix plus corresponding test updates.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was fully unambiguous and self-contained)

## Notes for the next worker
No MCP usage required — this is a pure logic/unit-test fix with no external service interaction. The fix is localized entirely to `mapBreakpoint` in `lib/webflow-converter/breakpoints.ts`; `variantKey` and downstream `css.ts` consumers were untouched (and unaffected, other than the new passing E2E case in css.test.ts).
