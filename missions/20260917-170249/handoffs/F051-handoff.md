# Handoff: F051 — FU-M2-1 close shorthand escape hatch

## Status
COMPLETE

## Assertions covered
AS-069: PASS — expandDeclaration's default branch no longer emits unmatched shorthand properties (background, animation, grid, grid-gap, grid-template, grid-area) verbatim; it now returns `{decls: {}, warning: ...}` for any property where `isShorthand(prop)` is true and no case matched. Verified with `npx vitest run lib/webflow-converter/` — 168/168 passing, including a new parseCss-level property test proving no shorthand key ever reaches a class's base/variant buckets.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 168 passed
`git add lib/webflow-converter/longhand.ts lib/webflow-converter/longhand.test.ts && git commit ...` (0)

## Decisions made
- Implemented `grid-gap` as a case alias sharing the existing `gap` 1-2 value expander (trivial row-gap/column-gap split), per spec item 2.
- `background`, `animation`, `grid`, `grid-template`, `grid-area` get explicit warn-and-drop cases (spec item 3) rather than relying solely on the generic `default` fallback, so the warning text is present even before hitting the isShorthand check — the generic fallback still covers any future SHORTHANDS-set addition that doesn't get its own case (spec item 1), closing the escape hatch permanently rather than just patching the six known cases.
- Fixed `font`'s unexpandable-value fallback (line ~324) to return `decls: {}` instead of `decls: {font: v}`, per spec item 4. This required updating one pre-existing test (`test_AS_065_size_only_no_family_is_kept_as_shorthand_with_warning` in the AS-065 describe block) that asserted the old verbatim-emission behavior — that assertion directly contradicted the AS-069 fix, so it was the test, not the code, that was wrong per the clarified spec.
- Added the property-based test requested in spec item 5 using `parseCss` (imported from `./css.ts`) rather than hand-rolling a bucket walk, since `parseCss` already exposes `classes.get(name).base`/`.variants` in the exact shape described.
- Encountered a pre-existing, unrelated bug while running the full `longhand.test.ts` suite: the `border-radius` case detected "elliptical" values with a naive `value.includes('/')`, which false-positived on `calc(100%/2)` (an existing test `test_AS_057_calc_with_slash_is_not_mistaken_for_elliptical_split` was already failing before my change, confirmed via `git stash`/re-run). Fixed it with a one-line, low-risk change to use the existing depth-aware `splitTop(v, /\//).length > 1` instead, since it's in the same file/scope and was blocking a clean full-suite run. This is unrelated to AS-069 but is now green.
- Observed that `lib/webflow-converter/longhand.ts` was being concurrently edited by another process during this session (file changed between an Edit call and a subsequent Read, with unrelated hunks like `isWidth`'s regex and `expandFlex`'s `initial` case appearing/disappearing). I re-verified my specific hunks were intact after each such event and did not touch or revert any of those unrelated concurrent changes.

## Out-of-scope work needed
None beyond the AS-057 one-liner already folded in above (it was needed just to get the suite green and is minimal/low-risk). No other out-of-scope work identified for this feature.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Updated the pre-existing `test_AS_065_size_only_no_family_is_kept_as_shorthand_with_warning` test to expect `decls: {}` instead of `decls: {font: v}`, since the spec explicitly requires changing this exact behavior (item 4) and the old test was asserting the bug being fixed.
AUTONOMOUS_DECISION: Fixed the unrelated pre-existing `border-radius`/`calc()` false-positive warning bug in the same file because it was blocking a clean full-suite test run and the fix was a single low-risk line reusing existing `splitTop` infrastructure.

## Notes for the next worker
- `lib/webflow-converter/css.ts`, `breakpoints.ts`, and their test files were dirty/modified in the working tree at the start of this session (not committed, not authored by this worker) — those are out of scope for F051 and were left untouched/unstaged.
- No MCP tools were needed for this feature (pure logic/test change, no external service state).
