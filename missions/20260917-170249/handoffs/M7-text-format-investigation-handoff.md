# Handoff: M7 — Webflow Designer paste crash investigation

## Status
COMPLETE

## Assertions covered
No assertion IDs were assigned to this task (adversarial bugfix / investigation, not a contract feature). No AS-NNN lines apply.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run lib/webflow-converter/` (0) — 409 passed (9 files)

## Decisions made

### Investigation redirected mid-task
This task was originally scoped to investigate a hypothesized text-node
format bug ("`{"_id":...,"type":"text",...}` children of Block/Heading
crash Webflow"). Partway through investigating the node-tree shape, the
coordinator sent a course-correction with the actual browser console error:
`Error: Invalid style type: undefined at buildStyleBlock`. That error comes
from Webflow's **style** engine, not its node-tree parser, so the
investigation was redirected to `styleLess` CSS property-name compatibility,
per the coordinator's updated instructions. The original text-node
hypothesis was not pursued further (see "Out-of-scope work needed" below for
what was already found there, in case it turns out to be a second, separate
bug).

### Root cause: two families of property names not recognized by Webflow's `buildStyleBlock`

Webflow's clipboard style engine (`buildStyleBlock`, called when it processes
`styles[].styleLess` on paste) keys style application by a fixed "style
type" lookup. Passing a property name it has no entry for makes that lookup
resolve to `undefined`, which `buildStyleBlock` then treats as a fatal error
rather than skipping the unknown property — crashing the whole paste, not
just dropping the one declaration.

`lib/webflow-converter/longhand.ts`'s `expandDeclaration()` is the single
place all CSS declarations pass through before they're joined into
`styleLess` (see `css.ts`'s `walk()` → `toStyleLess()` in `emit.ts`). Two
property families were reaching `styleLess` under names Webflow doesn't
recognize:

1. **`text-decoration-line` / `-color` / `-thickness` / `-style`** — these
   CSS3/4 longhands were on the `PASS_THROUGH` allow-list and were emitted
   verbatim. Webflow's style panel only has one style type for text
   decoration: the `text-decoration` shorthand itself (its value vocabulary
   — `underline`, `line-through`, `none`, etc. — is exactly what
   `text-decoration` accepts as a single value). Any HTML/CSS authored with
   the modern longhand form (increasingly common, e.g. Tailwind's
   `decoration-*` utilities compile to these) was silently producing a
   crashing payload.

2. **`grid-template-columns` / `-rows` / `-areas`** — these longhands are
   not shorthands per the `css-shorthand-properties` vocabulary (so they
   never hit the "unsupported shorthand, drop it" branch that already
   protects `grid`, `grid-template`, `grid-area`, `grid-column`, `grid-row`),
   and were not on any block-list, so they fell through to the generic
   pass-through default and were emitted verbatim — including function
   values like `repeat(3, 1fr)` that Webflow's Designer has no way to
   represent from a pasted `styleLess` string (CSS Grid in Webflow is
   configured through its own grid UI, not free-form pasted grid CSS).

### Fix
- Removed the four `text-decoration-*` longhands from `PASS_THROUGH`.
- Added an explicit case in `expandDeclaration()`: `text-decoration-line`
  folds its value into the `text-decoration` key (safe, since the two share
  a value vocabulary for the common case). `text-decoration-color` /
  `-thickness` / `-style` are dropped with a warning — Webflow's single
  `text-decoration` property has no slot to carry them, and there's no safe
  way to fold a color/thickness into a `text-decoration` value.
- Added `text-decoration` (the shorthand itself) to `PASS_THROUGH`. It was
  previously in `SHORTHANDS` with no dedicated `case` in the switch, so any
  literal `text-decoration: none;` in source CSS was already being silently
  **dropped entirely** — a separate, pre-existing correctness bug (not a
  crash, but data loss) fixed as part of the same change, since it's the
  same property. `text-decoration` stays in `SHORTHANDS` too (an existing
  contract test, `test_AS_069_shorthand_vocabulary_whitelist_...`, requires
  `isShorthand('text-decoration') === true`) — `PASS_THROUGH` is checked
  first in the default branch, so it still passes through un-dropped.
- Added `grid-template-columns`, `grid-template-rows`, `grid-template-areas`
  as an explicit drop-with-warning case (and a defensive fallback set,
  `UNSUPPORTED_GRID_LONGHANDS`, in the default branch) so these three
  longhands are never emitted verbatim, regardless of whether their value
  uses a function like `repeat()`.
- Verified against `~/Desktop/html-to-webflow` (the reference prototype this
  converter is ported from, confirmed by the user to produce payloads
  Webflow's Designer accepts) — its `longhand.mjs` has no case at all for
  `grid-template-columns`/`-rows`/`-areas` or any `text-decoration-*`
  longhand, and treats unhandled `grid`/`grid-template`/`grid-area` as
  "left as shorthand — Webflow may reject it" (a warning, not a guaranteed
  drop) — i.e. the reference implementation never had authored HTML/CSS
  exercising these exact property names, so this bug was novel to inputs our
  converter's broader property coverage started accepting.

## Out-of-scope work needed

- **Original text-node hypothesis, not fully resolved.** Before the
  redirect, reading `lib/webflow-converter/emit.ts` alongside the reference
  prototype (`~/Desktop/html-to-webflow/src/emit.mjs`) turned up a real
  structural difference worth flagging for a follow-up, independent of the
  `buildStyleBlock` crash fixed here:
  - The reference prototype's `payload.payload.nodes` is a **flat array**
    of all nodes (elements and text), where each element's `children` is an
    array of **`_id` string references** into that same flat array (and a
    final reordering step puts the pasted roots first). Text nodes there
    are `{ _id, text: true, v: <string> }` — a boolean `text` flag plus the
    literal text content in `v`, not a `type: "text"` discriminator with a
    nested `{text, html}` object.
  - Our current `lib/webflow-converter/emit.ts` instead nests full child
    node **objects** (both element and text children) directly inside each
    parent's `children` array — never flattened into `payload.nodes` — and
    text children use `{ _id, type: "text", v: 1, text: { text, html } }`.
  - This was NOT changed in this task, since the coordinator's redirect
    established the actual reported crash is in the style engine, not the
    node tree, and the existing 409 tests assert the current nested-object
    shape throughout `emit.test.ts`/`convert.test.ts`/`validator.test.ts`
    (a change would be a large, three-file refactor). If a Designer crash
    is still reproduced with the `styleLess` fix in place, this flat-array /
    `{text: true, v: string}` node shape is the next thing to try — it may
    be that Webflow's Designer accepts nested-object children for element
    types fine but still specifically rejects the `type: "text"` +
    `text: {text, html}` shape used for text runs. This needs an actual
    paste-and-observe verification against Webflow (no MCP or automated way
    to drive the Designer's clipboard paste from this environment) before
    committing to a rewrite this large.
- No other out-of-scope items identified for the `styleLess` property-name
  fix itself.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to fold `text-decoration-line`'s value into
`text-decoration` (rather than dropping it like the other three longhands)
because the two properties share the same primary value vocabulary
(`underline`/`overline`/`line-through`/`none`, possibly space-separated) —
this preserves the author's intent instead of silently discarding valid,
commonly-generated (e.g. Tailwind `decoration-*`) CSS.

AUTONOMOUS_DECISION: Added `text-decoration` to `PASS_THROUGH` instead of
giving it a dedicated `case` in `expandDeclaration()`'s switch, so all the
existing "every known shorthand from the independent `css-shorthand-properties`
vocabulary must not appear verbatim in decls, unless it's on `PASS_THROUGH`"
sweep tests in `longhand.test.ts` treat it consistently with the other
Webflow-native-but-technically-shorthand properties already on that list,
without needing to touch those tests.

## Notes for the next worker
- No MCP tools were used or needed — this is pure in-repo TypeScript/CSS
  logic with no external service state involved.
- If the Designer still crashes after this fix, the next thing to check
  (in order): (1) the flat-node-array / text-node-shape difference
  documented above in "Out-of-scope work needed", (2) whether any other
  CSS property our converter now supports (border/background/font/flex
  expansion, etc.) that the reference prototype never exercised also maps
  to a Webflow-unrecognized property name — the `buildStyleBlock` crash
  class isn't necessarily fully closed by fixing just these two families,
  since there's no way from this environment to get Webflow's actual style
  type whitelist other than reasoning from the reference prototype's proven
  behavior and the coordinator-supplied console error.
