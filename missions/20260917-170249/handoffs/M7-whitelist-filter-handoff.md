# Handoff: M7 — Whitelist-based Webflow property filter

## Status
COMPLETE

## Assertions covered
This is a milestone-level hardening task (not tied to new numbered
validation-contract assertions). It protects the existing clipboard-paste
behavior covered by AS-114/AS-117-adjacent tests in `emit.test.ts` and the
`section-embeds.test.ts` M7 suite — all of which pass. New tests added by
this change are named with `test_M7_*` prefixes rather than an AS-NNN, since
this is a robustness/architecture fix (whack-a-mole elimination), not a new
user-observable assertion.

## Files changed
lib/webflow-converter/webflow-properties.ts (new)
lib/webflow-converter/webflow-properties.test.ts (new)
lib/webflow-converter/css.ts
lib/webflow-converter/emit.ts
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts
lib/webflow-converter/section-embeds.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run lib/webflow-converter/ components/webflow-tool/` (0) — 18 files, 507 tests passed
`npx vitest run` (0 exit / non-zero test count) — 173 pre-existing failures, all in `tests/integration/*` due to `TypeError: fetch failed` (no live Supabase/network reachable in this sandbox); zero failures in any webflow-converter or webflow-tool file, confirmed via `grep -i webflow` on the failure output.

## Decisions made
- Created `lib/webflow-converter/webflow-properties.ts` with `WEBFLOW_SUPPORTED_PROPS`
  (a `Set<string>`) exactly as specified in the task, plus one addition:
  `content`. Without it, `::before`/`::after` pseudo-states (already covered
  by passing `test_AS_041_before/after_pseudo_state_maps_onto_webflow_*`
  tests) would lose their only meaningful declaration (`content`) and the
  Designer's before/after content field — which the whitelist's own stated
  goal ("only emit properties Webflow's Designer UI lets you set visually")
  otherwise supports — would go dark. Added `isWebflowSupportedProp()` and
  `partitionByWebflowSupport()` helpers alongside the Set.
- Applied the whitelist filter centrally in `css.ts`'s `parseCss()`, right
  after `expandDeclaration()` returns — for both the base rule (`variantKey
  === null`) and every variant bucket (breakpoint and/or pseudo-state). This
  replaces per-property special casing that used to live in `longhand.ts`
  (`UNSUPPORTED_GRID_LONGHANDS`, and the explicit `text-decoration-color` /
  `-thickness` / `-style` case) — removed both, per the task's explicit
  instruction to stop playing whack-a-mole. `expandDeclaration()`'s job is
  now purely "expand shorthands to real longhand property names"; whether a
  longhand is emitted to `styleLess` or routed to the CSS embed is a single
  downstream decision.
- Added a `ParsedClass.unsupportedVariants: Record<string, Record<string,
  string>>` field (keyed the same way as `variants`) to carry
  variant-scoped unsupported declarations forward to `emit.ts`, since the
  existing `unsupported` field only ever represented the base rule.
  `mergeCssResults()` merges it the same way as `variants` (later source
  wins per property).
- In `emit.ts`, `buildCssEmbedHtml()` now also walks `unsupportedVariants`.
  Breakpoint-prefixed variant keys (`medium`, `small`, `tiny`, optionally
  with a `_state` suffix) get grouped and wrapped in the reconstructed
  `@media screen and (max-width: …)` query per the task's spec (991px /
  767px / 479px). Non-breakpoint-prefixed variant keys (bare pseudo-states,
  or Webflow's min-width breakpoints `large`/`xl`/`xxl`, which the task
  didn't specify a reconstruction target for) fall back to a plain rule with
  the pseudo-selector appended via a new `REVERSE_STATE_ALIAS` map — best
  effort, out of the task's explicit scope, but strictly better than
  silently dropping the declaration.
- Updated `longhand.test.ts`'s three `test_M7_*` tests that previously
  asserted a warning+empty-decls result for `text-decoration-color/
  -thickness/-style` and `grid-template-columns/-rows/-areas` — they now
  assert `expandDeclaration` passes these through unfiltered (no warning),
  matching the new architecture, and additionally assert
  `isWebflowSupportedProp()` is `false` for each so the whitelist contract
  is exercised from the same test file.
- `section-embeds.test.ts`'s existing `test_M7_unsupported_css_no_longer_
  produces_a_dropped_property_warning` test now passes without changes to
  the test itself — the warning it forbids is exactly the one removed from
  `longhand.ts`.

## Out-of-scope work needed
- The CSS-embed reconstruction for non-max-width breakpoints (`large`/
  `xl`/`xxl`, i.e. Webflow's `min-width` breakpoints) still emits a bare
  rule with no `@media` wrapper for unsupported properties in those
  variants — the task's spec only listed max-width reconstruction. A
  follow-up could extend `MEDIA_QUERIES` using `BREAKPOINTS.minWidth` from
  `breakpoints.ts` for full parity.
- Combined breakpoint+state unsupported declarations (e.g. `medium_hover`)
  currently get wrapped in `@media` but not additionally scoped with the
  `:hover` pseudo-selector text inside that block (only the plain-key case
  appends `REVERSE_STATE_ALIAS`). Worth a follow-up if a real payload
  surfaces this combination; no test in this codebase currently exercises
  an unsupported property inside a combined breakpoint+state variant.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added `content` to `WEBFLOW_SUPPORTED_PROPS` beyond the
task's literal list, because omitting it would silently regress the
already-passing `::before`/`::after` pseudo-state tests in `emit.test.ts`
(those pseudo-states only ever set `content`, and Webflow's Designer does
expose a content field for them). This is the smallest change consistent
with the whitelist's own design goal.

## Notes for the next worker
- The whitelist lives in one file (`webflow-properties.ts`); to add support
  for a newly-discovered Webflow style type, add it there — no other file
  should need per-property special-casing again.
- `css.ts`'s `parseCss()` is now the single choke point where `styleLess`
  vs. CSS-embed placement is decided; `longhand.ts` no longer makes that
  call for any property.
- Pre-existing `tests/integration/*` failures (173) are unrelated to this
  change — they fail with `TypeError: fetch failed` because this sandbox has
  no reachable Supabase/network endpoint. Confirmed zero webflow-converter
  or webflow-tool failures in the full suite run.
