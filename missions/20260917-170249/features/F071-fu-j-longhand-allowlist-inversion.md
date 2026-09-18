# F071: invert expandDeclaration default branch to longhand allow-list (blocker AS-069)

**Milestone:** M2 follow-ups round 6
**Depends on:** F067

## Clarified implementation (inherited)

## Follow-up scope (from M2-scrutiny-6.md B-4)

The AS-069 problem cannot be solved by additive patches to `EXTRA_SHORTHANDS` — every round adds the named instances but the next round finds new ones (`marker`, `position-try` in round 6). The assertion requires a universal: no shorthand reaches the payload.

### The fix: invert the default branch of `expandDeclaration`

Instead of: "warn-and-drop known shorthands, pass through everything else"
Do: "pass through only properties on an explicit longhand allow-list, warn-and-drop everything else"

Build the LONGHAND_ALLOW_LIST as a Set of all CSS properties that:
1. Are not shorthands — they have no sub-properties
2. Webflow's style panel accepts

Start from the union of:
- All properties currently in PASS_THROUGH (these are accepted longhands)
- All properties produced by the existing expanders (the values they emit)
- Common CSS longhands: color, display, opacity, cursor, overflow, overflow-x, overflow-y, visibility, z-index, position, top, right, bottom, left, float, clear, box-sizing, white-space, word-break, word-wrap, overflow-wrap, text-overflow, text-align, text-align-last, text-indent, text-transform, text-decoration-color, text-decoration-style, text-decoration-thickness, text-underline-offset, letter-spacing, line-height, vertical-align, list-style-type, list-style-position, list-style-image, pointer-events, user-select, resize, appearance, content, counter-reset, counter-increment, object-fit, object-position, table-layout, border-collapse, border-spacing, caption-side, empty-cells, fill, stroke, stroke-width, stroke-dasharray, stroke-dashoffset, vector-effect, mix-blend-mode, isolation, will-change, aspect-ratio, contain, grid-template-columns, grid-template-rows, grid-template-areas, grid-auto-columns, grid-auto-rows, grid-auto-flow, align-content, align-items, align-self, justify-content, justify-items, justify-self, order, flex-grow, flex-shrink, flex-basis, column-count, column-gap, column-rule-width, column-rule-style, column-rule-color, column-fill, column-span, writing-mode, direction, unicode-bidi, scroll-behavior, scroll-snap-type, scroll-snap-align, scroll-snap-stop, overscroll-behavior-x, overscroll-behavior-y, touch-action, -webkit-overflow-scrolling, transform, transform-origin, transform-style, perspective, perspective-origin, backface-visibility, filter, backdrop-filter, clip-path, mask, mask-image, mask-size, mask-position, mask-repeat, mask-origin, mask-clip

When `expandDeclaration` reaches the default branch (no case matched), check if `prop` is in `LONGHAND_ALLOW_LIST`:
- YES → `return { decls: { [prop]: value } }` (pass through)
- NO → warn `"'${prop}' is not a supported Webflow property — declaration dropped"` and return `{}`

This way `marker`, `position-try`, and any future unknown shorthand automatically produce a warning instead of corrupting the payload.

Add tests:
- `expandDeclaration('marker', 'url(#m)')` → `{}` + warning
- `expandDeclaration('position-try', 'flip-block')` → `{}` + warning
- `expandDeclaration('color', 'red')` → `{color: 'red'}` (no warning — it's on the allow-list)
- `expandDeclaration('display', 'flex')` → `{display: 'flex'}` (no warning)
- `expandDeclaration('some-future-shorthand', 'x')` → `{}` + warning

Update the AS-069 test block to: enumerate a sample of known shorthands AND `marker`/`position-try`, verify all warn-and-drop.

## Definition of done
- `npx vitest run lib/webflow-converter/` 0 failed
- `npx tsc --noEmit` clean
- `npm run lint` clean
- Handoff to missions/20260917-170249/handoffs/F071-handoff.md
- Commit: "fix(AS-069): invert expandDeclaration to longhand allow-list, deny unknown properties"
