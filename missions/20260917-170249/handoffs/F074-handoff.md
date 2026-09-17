# Handoff: F074 — fu-m-font-variant-longhand

## Status
COMPLETE

## Assertions covered
AS-069: PASS — added output-side sweep test asserting the font shorthand expander never emits `font-variant` (a shorthand) and correctly emits `font-variant-caps`; verified all emitted keys pass `isShorthand(key) === false`.
AS-135: PASS — fixed dead-filter assertion in the AS-135 end-to-end regression test (`w.includes("is not a recognized")` matched nothing since no code produces that string); now asserts `result.warnings` is empty for the hero stylesheet, which genuinely has no shorthands.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts
lib/webflow-converter/css.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 258 tests passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Changed `expandFont` in `longhand.ts` to set `out['font-variant-caps']` instead of `out['font-variant']` — `font-variant` itself is a shorthand and Webflow's clipboard format rejects shorthand declarations, which is exactly the bug AS-069's sweep test now guards against.
- `isShorthand` was already exported from `longhand.ts`; no export change was needed.
- Updated the existing test `test_AS_065_small_caps_sets_font_variant` to assert on `font-variant-caps` so it reflects the corrected behavior rather than the bug.
- Left the test's original name (`test_AS_065_small_caps_sets_font_variant`) unchanged since it's an AS-065 test being kept consistent with the fix, not renamed as part of this feature's scope.

## Out-of-scope work needed
None identified — this was a narrow two-file bug fix plus test corrections as scoped by the spec.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was unambiguous and fully prescriptive)

## Notes for the next worker
No MCP usage required for this feature (pure code/test fix, no external service). All four described fixes were applied exactly as specified in the feature spec.
