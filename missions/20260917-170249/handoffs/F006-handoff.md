# Handoff: F006 — longhand border and radius

## Status
COMPLETE

## Assertions covered
AS-055: PASS — border shorthand expands to border-{side}-width/style/color on all four sides; global keyword dropped with warning.
AS-056: PASS — border-top/right/bottom/left expand only their own side; border-width/border-style/border-color expand via the 1-4 value box rule across all four sides.
AS-057: PASS — border-radius expands with 1/2/3/4-value corner rule preserving TL/TR/BR/BL order; elliptical `a b / c d` form flattens to horizontal values with a warning; global keyword dropped with warning.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/longhand.test.ts` (0) — 95 passed, 0 failed
`npx tsc --noEmit -p .` (0, no longhand-related errors)

## Decisions made
- Ported `parseBorderParts` and `expandBorderRadius` byte-for-byte from `~/Desktop/html-to-webflow/src/longhand.mjs`, adding TS types (`BorderParts` interface) per the clarified "port fidelity: byte-for-byte logic port" answer.
- `border`, `border-top/right/bottom/left`, `border-width/style/color`, and `border-radius` cases were added to the existing `switch` in `expandDeclaration` alongside cases already contributed concurrently by sibling features F007 (gap/overflow/place-*), F008 (flex/flex-flow), and others (transition, outline, list-style, font) that landed in the same file while this feature was in progress. Only the border/border-radius logic and its own module-level helpers (`BORDER_STYLES`, `NAMED_WIDTHS`, `isWidth`, `parseBorderParts`, `expandBorderRadius`, `BorderParts`) are this feature's contribution; nothing belonging to sibling features was altered.
- `expandBorderRadius` keeps only the horizontal radii for the elliptical `/` form and returns a warning, matching the reference prototype exactly (Webflow's format has one radius value per corner, no elliptical support).
- Test `test_AS_055_color_style_width_in_declaration_order` documents (rather than fights) the reference prototype's token-classification order: `parseBorderParts` fills the first unfilled matching slot in left-to-right order (style keyword -> style, width-shaped token -> width, anything else -> color), so a `var()` token is width-shaped and can occupy the width slot even when a following bare keyword like `thin` ends up in the color slot. This is inherited prototype behavior, not a new departure, so it was captured as a passing test rather than "fixed."

## Out-of-scope work needed
None — background, grid, animation, and any remaining shorthand properties are covered by other sibling features per the module's own scope comment.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept exact edge-case behavior of `parseBorderParts` from the prototype (including the var()-as-width classification quirk) rather than adding new heuristics, per the clarified "Port fidelity: byte-for-byte logic port" and "Validation rules: match the reference prototype's behavior exactly" answers.

## Notes for the next worker
- This file (`lib/webflow-converter/longhand.ts`) is being edited concurrently by multiple sibling-feature workers (F007, F008, and others already landed transition/outline/list-style/font cases by the time this feature ran). Expect merge friction — re-read the file immediately before each edit; `Edit`/`Write` will reject stale reads.
- No MCP usage — pure local TypeScript logic, no external service touched.
