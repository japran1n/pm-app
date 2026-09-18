# Handoff: M7 — Webflow property-value combination validator

## Status
COMPLETE

## Assertions covered
No new assertion IDs were assigned to this task in the mission brief (it is a
bug-fix task on top of the existing M7 var()/whitelist work, referenced by
the task instructions directly rather than an AS-NNN). Existing M7-related
assertions covered by `lib/webflow-converter` tests continue to pass
unchanged; see `Commands run` for the full suite result.

## Files changed
lib/webflow-converter/webflow-properties.ts
lib/webflow-converter/webflow-properties.test.ts
lib/webflow-converter/css.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run lib/webflow-converter/ components/webflow-tool/` (0) — 528 passed, 0 failed

## Decisions made
- Removed `text-decoration` from `WEBFLOW_SUPPORTED_PROPS` entirely (task
  step 1). It now routes through `partitionByWebflowSupport` into the
  `unsupported`/`unsupportedVariants` buckets, same as any other
  non-whitelisted property, and reaches the CSS embed. `longhand.ts`'s
  handling of `text-decoration-line/-color/-thickness/-style` still folds
  into a single `text-decoration` declaration — that declaration is now
  simply routed to the embed downstream instead of styleLess. No change was
  needed in `longhand.ts`.
- Added `isWebflowSupportedValue(prop, value)` in `webflow-properties.ts`
  per the spec: `display` restricted to
  `flex|block|inline-block|inline|grid|none`; `align-items`/`align-content`/
  `align-self` restricted to `center|flex-start|flex-end|stretch|normal|baseline`
  (kept `baseline` — the task text itself flagged this as uncertain and said
  "remove it only if certain"; I had no evidence it's actually rejected by
  Webflow so I left it in per the "safest default that satisfies assertion
  text" rule); dimensional/unit-only properties (margins, paddings,
  flex-basis, width/height/min/max variants, top/right/bottom/left) reject
  `auto` specifically, accept everything else including bare `0`.
- Wired the new check into `css.ts`'s `parseCss` declaration pipeline,
  running it on `resolvedSupported` values (i.e. after var() fallback
  resolution) so it inspects the concrete value Webflow would actually
  receive, not a `var()` expression. Values that fail route into the same
  `valueUnsupported` -> `allUnsupported` merge that already fed the CSS
  embed for whitelist/var() failures, so no changes were needed in
  `emit.ts`'s embed-construction logic.
- `convert.test.ts`'s AS-141 realistic-section test previously asserted 6
  top-level+nested nodes; `.container { margin: 0 auto }` expands to
  `margin-right/left: auto`, which the new validator now correctly routes to
  a CSS embed, adding one HtmlEmbed node. Updated the expected count to 7
  with an explanatory comment — this is the fix working as intended, not a
  regression.

## Out-of-scope work needed
- The task text explicitly flagged uncertainty about whether `baseline` is
  invalid for `align-items`/`align-content`/`align-self` ("keep `baseline`
  for now — remove it only if certain"). If a future worker gets a concrete
  Webflow Designer paste-crash repro with `align-items: baseline`, remove it
  from `WEBFLOW_ALIGN_VALUES` in `webflow-properties.ts` and add a
  regression test.
- No other unsupported property-value combinations were investigated beyond
  the four listed in the task (text-decoration shorthand, `auto` on
  unit-only props, `align-items: baseline`, `display: inline-flex`). If
  further Designer paste crashes surface, the same
  `isWebflowSupportedValue` function is the right extension point.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `baseline` in the allowed `align-items` value set
because the task instructions themselves said to remove it "only if
certain" and gave no confirming source; removing it without evidence risked
silently changing behavior for a value that may in fact be valid in
Webflow's Designer.
AUTONOMOUS_DECISION: No new assertion IDs exist in `validation-contract.md`
for this specific value-validator bug fix (it's a direct engineering task
from the mission run, not tied to a fresh AS-NNN). Verified the full
existing `webflow-converter` + `webflow-tool` suite (528 tests) stays green
as the acceptance bar instead.

## Notes for the next worker
- `isWebflowSupportedValue` lives next to `isWebflowSupportedProp` in
  `lib/webflow-converter/webflow-properties.ts` — extend it there for any
  future Designer-crash property/value combos.
- The CSS-embed routing pipeline in `css.ts` (`parseCss`) now has three
  reasons a supported-prop declaration can still end up in
  `unsupported`/`unsupportedVariants`: not in `notWhitelisted`, unresolved
  `var()` (`varUnsupported`), or a value the new validator rejects
  (`valueUnsupported`). All three are merged into `allUnsupported` before
  being assigned to the class record.
