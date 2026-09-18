# Handoff: M7 — Inject CSS embed + JS embed into each section

## Status
COMPLETE

## Assertions covered
No assertion IDs were assigned to this feature in validation-contract.md (it
is a direct M7 spec, not a numbered F<NNN> feature). Relevant existing
assertions verified not to regress:
AS-120: PASS — every warning still surfaces in `warnings`; the specific
"not supported" warnings for grid-template-* and text-decoration-color/
-thickness/-style are gone by design (relocated into the CSS embed instead
of dropped), all other warnings unaffected.
AS-135/AS-136/AS-139: PASS — new logic is pure, covered by unit tests, runs
under `npm test`/vitest with no DOM dependency.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/css.ts
lib/webflow-converter/emit.ts
lib/webflow-converter/convert.ts
lib/webflow-converter/section-embeds.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/webflow-converter/ components/webflow-tool/` (0)
`npx vitest run lib/webflow-converter/ components/webflow-tool/` (0) — 497/497 passed, including 8 new tests in section-embeds.test.ts

## Decisions made
- Added `unsupported?: Record<string,string>` to longhand.ts's `ExpandResult`,
  set only for the declarations that were already being dropped specifically
  because Webflow's clipboard engine has no style-type entry for them:
  `text-decoration-color/-thickness/-style` and
  `grid-template-columns/-rows/-areas`. These are the properties that
  actually get dropped in this codebase today.
- `gap`/`row-gap`/`column-gap`/`grid-column-gap`/`grid-row-gap` were **not**
  touched. Checked the actual code path: `gap`/`grid-gap` already expand
  into `row-gap`/`column-gap` longhands, and those longhands (along with the
  `grid-*-gap` prefixed variants) fall through `expandDeclaration()`'s
  default case and are passed through verbatim as real decls — they are not
  currently dropped or warned about, so there is nothing to relocate into an
  embed for them. The feature spec listed them as candidates ("if it's being
  dropped") — verified they are not, in this codebase.
- `css.ts`'s `ParsedClass` gained an `unsupported: Record<string,string>`
  field, populated instead of pushing a warning when
  `expandDeclaration()` returns `unsupported`. This means those specific
  "is not supported" warnings no longer appear in `warnings` (per spec step
  6) — the declarations aren't lost, they're consumed by emit.ts instead.
  `mergeCssResults()` merges this field too.
- `emit.ts`: `emitWebflow(html, cssMap, scripts?)` gained a third optional
  `scripts` parameter (inline JS strings). After building the node tree, it
  recursively finds every node with `tag === "section"` (top-level `<section>`
  elements only — not `<header>`/`<footer>`, which also map to Webflow's
  `Section` type but the spec explicitly says "every `<section>`") and:
  - Computes the section's subtree class lists, matches them against
    `cssMap`'s classes that have unsupported declarations (including combo
    chains, reusing the same "chain fully present on one node" logic
    `convert.ts` already uses for the AS-051 unused-class check), and if any
    match, builds a `<style>...</style>` embed HTML string and unshifts an
    `HtmlEmbed` node as the section's first child.
  - If any inline script content exists, wraps it in `<script>...</script>`
    and pushes an `HtmlEmbed` node as the section's last child. External
    `<script src>` tag markup (which `js-extract.ts`'s `extractScripts()`
    also returns, as raw tag `outerHTML`) is filtered out of the embed
    content — only inline code content is valid inside a wrapped
    `<script>` block.
  - Every section gets both embeds independently (literal reading of "for
    every `<section>` ... inject" — each qualifying section gets its own
    CSS embed scoped to its own subtree, and the same global JS embed if
    script content exists anywhere in the input).
  - If at least one embed was injected anywhere, an `is-hidden` style stub
    (`styleLess: "display: none;"`) is pushed once, only if not already
    present.
- **Did not remove `customCode.scripts`** from `convert.ts`'s `ConvertResult`.
  The spec described "instead of putting JS in customCode, inject a JS
  embed" as the motivating problem, but `convert.ts`'s `customCode.scripts`
  surface is depended on by F019 (emit-js-extraction) and F035 (copy custom
  code button) and their existing tests/UI. Removing it would be an
  undocumented breaking change to features outside this spec's stated
  "Touches". Instead this feature is purely additive: JS now *also* appears
  as a per-section embed in the payload itself, on top of the existing
  customCode surface. Flagged as an autonomous decision below.

## Out-of-scope work needed
None identified beyond the decision above. If the mission actually wants
`customCode.scripts`/the "Copy custom code" button removed now that JS lives
in-payload as an embed, that is a distinct UI/product decision touching
F035's clarified spec and should be a new feature, not silently done here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `customCode.scripts` (and the existing "Copy
custom code" button/UI) untouched and additive rather than removing it now
that JS is embedded in the payload, because the M7 spec's "Touches" is
scoped to emit.ts/longhand.ts and does not mention F035's UI; removing a
user-visible feature without a corresponding assertion change felt riskier
than duplicating the JS into both places.
AUTONOMOUS_DECISION: Limited "unsupported CSS relocated to embed" to the
properties actually dropped by the existing engine (text-decoration-color/
-thickness/-style, grid-template-columns/-rows/-areas) rather than also
special-casing gap/row-gap/column-gap, which pass through unmodified today
and are not warned about or dropped.
AUTONOMOUS_DECISION: Injected embeds only into nodes with `tag === "section"`
(not `header`/`footer`, which map to the same Webflow `Section` type) per
the literal "every `<section>`" wording in the spec.

## Notes for the next worker
- The CSS embed selector text reconstructs the original dotted class chain
  from `ParsedClass.comboOf`/`.name` (e.g. `.a.b`), matching the spec's
  "CSS class selectors, not Webflow class names" requirement.
- `buildEmbedNode` is exported from emit.ts in case a future feature needs to
  construct the same embed shape elsewhere (e.g. a manual "add custom code"
  UI feature).
- No MCP tools were used — this feature is pure conversion-engine logic with
  no external service touchpoints.
