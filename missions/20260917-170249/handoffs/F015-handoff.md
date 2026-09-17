# Handoff: F015 — HTML typemap (structural)

## Status
COMPLETE

## Assertions covered
AS-077: PASS — `<section>`/`<header>`/`<footer>` map to `type: 'Section'`, verified in test_AS_077_section_converts_to_section and test_AS_077_header_and_footer_convert_to_section.
AS-078: PASS — `<div>` and other structural semantic tags map to `type: 'Block'`, verified in test_AS_078_div_converts_to_block and test_AS_078_other_structural_semantic_tags_convert_to_block.
AS-079: PASS — h1-h6 map to `type: 'Heading'` with `level` 1-6, verified in test_AS_079_h1_through_h6_convert_to_heading_with_matching_level.
AS-080: PASS — `<p>` maps to `type: 'Paragraph'`, verified in test_AS_080_p_converts_to_paragraph (also blockquote covered as adjacent structural case).
AS-081: PASS — `<ul>`/`<ol>` map to `type: 'List'`, `<li>` maps to `type: 'ListItem'`, verified in test_AS_081_ul_and_ol_convert_to_list and test_AS_081_li_converts_to_list_item.

## Files changed
lib/webflow-converter/typemap.ts
lib/webflow-converter/typemap.test.ts

## Commands run
`npx vitest run lib/webflow-converter/typemap.test.ts` (0, 12 tests passed)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Ported the structural half only of the prototype's `mapTag()` from `~/Desktop/html-to-webflow/src/typemap.mjs` (section/header/footer/main/article/aside/nav/div/figure/figcaption, h1-h6, p/blockquote, ul/ol/li) plus the inline text tags (span/strong/em/b/i/small) and label/figcaption that already existed alongside them in that same switch statement in the prototype, since splitting those out further would have fragmented one cohesive switch for no benefit. Links, images, forms, buttons, br/hr, video/iframe/svg are explicitly out of scope per this feature's own note ("links/images/forms are separate features below") and are left to fall through to the generic default-Block-with-warning branch, matching the prototype's own default case.
- Renamed the exported function from `mapTag(tag, ctx)` to `getWebflowType(tagName)` per this task's explicit instruction, dropping the `ctx` (hasElementChildren/attrs) parameter since none of the structural branches ported here use it (only the out-of-scope `li`-with-children, `a`, `img`, and `button` branches used `ctx` in the prototype).
- Added a `level: number` field (1-6) for headings, computed from the tag digit, to satisfy this task's explicit return-shape instruction; the prototype instead put the digit in `data.tag`. Kept `data.tag`/`data.text` too, for continued structural fidelity with downstream consumers expecting the prototype's `data` shape.
- Unknown/unhandled tags return `{ type: 'Block', tag: 'div', warning: ... }`, same message format as the prototype's default case, satisfying "never throw for expected-bad input — return it as a warning/error entry."

## Out-of-scope work needed
- Links (`<a>`), images (`<img>`), and forms (`<form>`/`<input>`/`<textarea>`/`<select>`/`<button>`) mapping — covered by later F0xx features per this spec's own note.
- `<br>`/`<hr>`/`<video>`/`<iframe>`/`<svg>` special-case mapping (currently fall through to the generic unknown-tag default, which is a Block with a generic warning rather than the prototype's tag-specific warning text) — not required by this feature's assigned assertions (AS-077–081); a future feature can special-case these if an assertion requires it.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Included span/strong/em/b/i/small/label/figcaption in this port (rather than strictly the tag list named in the "Draft scope" line) because they were part of the same contiguous switch block in the prototype as the assigned structural tags, and excluding them would mean those tags silently mis-map to the generic default (losing the `data.text` marking) with no corresponding follow-up feature covering them. This is a minimal, low-risk superset that keeps the port faithful to the prototype's logic grouping.

## Notes for the next worker
- Reference prototype: `~/Desktop/html-to-webflow/src/typemap.mjs` — the full file (including link/image/form/button/br/hr/video/iframe branches) is the source for whichever future feature ports those remaining branches. Reuse the `linkData()` helper logic when that happens.
- `WebflowTypeInfo` is exported from `lib/webflow-converter/typemap.ts` for downstream emit/convert modules to import.
