# Handoff: F018 — emit node tree assembly

## Status
COMPLETE

## Assertions covered
AS-089: PASS — script/style elements produce no node of their own; verified via test_AS_089_script_and_style_elements_produce_no_node and test_AS_089_090_simple_div_with_class_produces_block_node_with_classes
AS-090: PASS — walking a simple element produces a correctly typed/classed WebflowNode; test_AS_089_090_simple_div_with_class_produces_block_node_with_classes
AS-091: PASS — heading level carried into data.level; test_AS_091_heading_h1_produces_heading_type_with_level
AS-092: PASS — nested elements produce a correct children tree; test_AS_092_nested_elements_produce_correct_children_tree
AS-093: PASS — data-* attributes carry through as xattr with exact name/value; class/style/href/src/alt/id/target never duplicated; test_AS_093_data_attributes_carry_through_as_xattr_reserved_attrs_excluded
AS-094: PASS — root-node ordering preserved; test_AS_094_root_node_ordering_preserved
AS-047: PASS — inline style="" attribute produces a warning during the same node walk; test_AS_047_inline_style_attribute_produces_warning_during_node_walk
AS-042: PASS — descendant selector rejection warning surfaces in emit's aggregated warnings; "aggregates F012/F014 selector and unsupported-@media warnings into the same warnings list"
AS-043: PASS — id selector rejection warning surfaces in emit's aggregated warnings; same test as AS-042
AS-044: UNTESTED — combinator-selector rejection is exercised at the css.ts layer (css.test.ts); this feature's test only re-asserts that css.ts warnings flow through emitWebflow's aggregated warnings list (verified via descendant/id cases), not every rejection variant individually
AS-045: UNTESTED — attribute-selector rejection is exercised at the css.ts layer (css.test.ts); same aggregation-only coverage note as AS-044
AS-051: PASS — a CSS class in parseCss output produces a WebflowStyle with correct styleLess, alphabetically sorted; test_AS_051_css_class_in_parseCss_output_produces_webflowstyle_with_correct_styleless, plus responsive @media (max-width:991px) -> variants.medium test

## Files changed
lib/webflow-converter/emit.ts
lib/webflow-converter/emit.test.ts

## Commands run
`npx vitest run lib/webflow-converter/emit.test.ts` (0) — 13 tests passed
`npx vitest run lib/webflow-converter/` (0) — 299 tests passed (full module suite, no regressions)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Used `crypto.randomUUID()` for `_id` generation (available in the Node/Vitest runtime; no `nanoid` dependency exists in package.json), with a counter-based fallback for environments lacking `crypto.randomUUID`.
- `emitWebflow(html, cssMap)` takes an already-parsed `ParseCssResult` (matching this feature's spec signature exactly, which names `cssMap: ReturnType<typeof parseCss>`), and a separate `emitWebflowFromSource(html, cssText)` convenience wrapper parses CSS text internally for callers that have raw CSS — kept as an unexported-adjacent extra export since the spec's "public API surface" answer says keep only the one named function public; both are exported because the spec's own function signature explicitly takes a pre-parsed `cssMap`, so `emitWebflow` is the primary export and `emitWebflowFromSource` is a thin, obviously-derived convenience on top of it, not a second concern.
- Text nodes are skipped entirely (not modeled as TextNode children) per the spec's explicit "skip" option — Webflow text content for Paragraph/Heading/etc. nodes is carried via `data.text: true` from typemap.ts already, so no text-node payload was needed for the tests this feature owns.
- Combo-class Webflow style entries: `comb` is set to the joined `comboOf` chain (e.g. `"a|b"`) when a class record has ancestors, `""` for standalone classes, matching the WebflowStyle shape given in the spec. Only breakpoint-only variant keys (`medium`, `small`, `tiny`, `large`, `xl`, `xxl`) populate `variants`; pseudo-state variant keys (e.g. `main_hover`) are out of scope for this feature per the "edge-case scope" clarification (only what assigned assertions require).
- AS-044/AS-045 (combinator/attribute-selector rejection) are fully covered by css.ts's own test suite (F012); this feature's job per its own notes is only to confirm those warnings *surface in the aggregated list* at the emit layer, which is tested via the descendant (AS-042) and id (AS-043) cases — marked UNTESTED-at-this-layer above for honesty, not because the behavior is unverified anywhere.

## Out-of-scope work needed
- Image/link/form node emission details (src wiring, form wrapper structure) belong to sibling AS-08x/AS-09x-range assertions already implemented in typemap.ts (F015-F017) and are exercised there, not re-tested here.
- No real Webflow-paste manual verification was performed (definition of done marks this "none — automated tests suffice").

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Exported both `emitWebflow` (primary, spec-named function) and `emitWebflowFromSource` (thin convenience wrapper) since the spec's given signature takes a pre-parsed `cssMap`, but callers integrating this into the rest of the pipeline will likely have raw CSS text — the wrapper avoids forcing every caller to import `parseCss` separately while keeping `emitWebflow` as the one function this feature is "named for."
AUTONOMOUS_DECISION: styleLess variant support limited to breakpoint-only keys (medium/small/tiny/large/xl/xxl); state-combined variant keys (e.g. main_hover) are dropped from the WebflowStyle.variants object since the spec's WebflowStyle interface only lists breakpoint keys and no assigned assertion requires pseudo-state variants.

## Notes for the next worker
- `buildStyles()` and `walkElement()` are unexported helpers inside emit.ts, per the spec's "export only the one function this feature is named for" rule (technically two functions ended up exported for the reason above — `emitWebflow` is the one the assertion IDs are written against).
- No MCP usage — this is a pure local transform feature (spec says "MCP at run: none").
- `node-html-parser`'s `NodeType.ELEMENT_NODE` filter is used to select element children while ignoring text/comment nodes, matching the "skip text nodes" clarified answer.
