# Handoff: F052 — fu-m2-2-unmappable-breakpoint-warn

## Status
COMPLETE

## Assertions covered
AS-048: PASS — `mapBreakpoint` now returns `null` for any max-width/min-width that does not exactly match one of Webflow's boundaries (479/767/991/1440/1920/2560), instead of silently snapping to 'medium'/'large'. `css.ts`'s existing `@media` handling already warns and skips the block's declarations whenever `mapBreakpoint` returns null, so `@media (max-width:1200px)` now produces the warning "@media (max-width: 1200px) does not map to a Webflow breakpoint — skipped" and contributes zero class entries. Verified with new tests in breakpoints.test.ts and css.test.ts.

## Files changed
lib/webflow-converter/breakpoints.ts
lib/webflow-converter/breakpoints.test.ts
lib/webflow-converter/css.test.ts

## Commands run
`npx vitest run lib/webflow-converter/breakpoints.test.ts lib/webflow-converter/css.test.ts` (0, 50 passed)
`npx vitest run lib/webflow-converter/` (non-zero — 4 pre-existing failures in longhand.test.ts, unrelated to this feature; see Notes)

## Decisions made
- Changed the boundary check in `mapBreakpoint` from `<=`/`>=` (nearest-fit fallback) to strict `===` equality against Webflow's exact breakpoint widths, per the spec. Any non-matching width now returns `null`.
- Did not modify `css.ts`: its `@media` handling (lines 112-122) already treats a `null` return from `mapBreakpoint` as "push a warning and skip the block" — this logic was already correct and just needed `mapBreakpoint` to stop lying about matches. Confirmed with a new `parseCss`-level test for `@media (max-width: 1200px)`.
- Updated the pre-existing mirror tests in breakpoints.test.ts that asserted the old fallback behavior (320px→tiny, 1200px→medium, 3000px→xxl, 1000px→large, 767.5px→medium) to assert `null` instead, since those widths don't exactly match a Webflow boundary. Added an explicit test at 767.0px (which does exactly match) to preserve fractional-parsing coverage for the success path.

## Out-of-scope work needed
None identified within this feature's scope. The `longhand.ts`/`longhand.test.ts` changes and failures present in the working tree predate this feature and are outside `breakpoints.ts`/`css.ts` scope — not touched or fixed here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "does not exactly match one of Webflow's boundaries" as strict numeric equality (`===`) rather than a tolerance/epsilon comparison, since the spec explicitly lists exact integer boundary values (479/767/991/1440/1920/2560) and the reference test suite uses whole-pixel media query values.

## Notes for the next worker
Pre-existing (not introduced by this feature) test failures exist in `lib/webflow-converter/longhand.test.ts` for `expandDeclaration('border', 'solid var(--accent) thin')` and a border-radius `calc(100%/2)` case — these come from uncommitted changes to `longhand.ts`/`longhand.test.ts` already present in the working tree before this feature started (confirmed via `git stash` — they fail even on stash-popped state, and `longhand.ts` was not touched by this feature). These are out of scope for F052 (AS-048 / breakpoints only) and should be picked up by whichever feature owns `longhand.ts`.
