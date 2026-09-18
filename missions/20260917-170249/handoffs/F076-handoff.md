# Handoff: F076 — emit Webflow envelope + combo-class parentage + id attribute + state variants

## Status
COMPLETE

## Assertions covered
AS-111: PASS — `emitWebflow()`'s returned `XscpData` object now carries `type: "@webflow/XscpData"`; verified by `test_AS_111_emitted_payload_includes_webflow_xscpdata_type`. Also covered indirectly via `test_AS_089_090_simple_div_with_class_produces_block_node_with_classes` and others (no regression) and by `convert()` exposing the same object as `result.payload` unchanged.
AS-091: PASS — `id` attributes are no longer suppressed; they are pushed onto `data.xattr` as `{ name: "id", value }` (in addition to `data-*` attrs), and `RESERVED_ATTRS` no longer includes `"id"`. Verified by `test_AS_091_id_attribute_round_trips_as_xattr_entry` and updated `test_AS_093_data_attributes_carry_through_as_xattr_reserved_attrs_excluded`.
AS_117: PASS — `buildStyles` now runs a second pass after building the style array, populating each base style's `children` array with the `_id`s of its combo styles (looked up via `style.comb`, which is now the base's `_id`, not a name string). Verified by `test_AS_117_combo_class_input_produces_base_style_children_containing_combo_id`.
AS-041: PASS — pseudo-state variant keys produced by `parseCss` (e.g. `"main_hover"`) are now mapped onto Webflow's variant slots (`hover`, `focused`, `pressed`, `nthChild` for `_placeholder`) instead of being silently discarded; unrecognized pseudo-states push a warning and are skipped. Verified by `test_AS_041_hover_pseudo_state_variant_maps_onto_webflow_hover_slot`.

## Files changed
lib/webflow-converter/emit.ts
lib/webflow-converter/emit.test.ts

## Commands run
`npx vitest run lib/webflow-converter/emit.test.ts` (0) — 17/17 passing
`npx vitest run lib/webflow-converter/` (exit 1 in the full working tree — see "Out-of-scope work needed" below; failures are entirely in `convert.test.ts`/`validator.test.ts`, none in `emit.test.ts`)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- `WebflowStyle.comb` previously stored a pipe-joined class-**name** string (`rec.comboOf.join("|")`), which could never match any style's `_id` for the combo-children second pass described in the spec. Changed `comb` to store the **immediate ancestor's `_id`** (`idByKey.get(comboOf[comboOf.length - 1])`) so the base-lookup-by-`_id` pattern in the spec's pseudocode actually works. This is a behavior change to an existing field but was necessary to satisfy AS-117's literal fix — the old value was unusable for that purpose.
- `id` is pushed to the front of the `xattr` array (`unshift`) rather than appended, since it typically appears first in the source attribute order and reads naturally as the node's primary identifier in the emitted output. `test_AS_093` was updated (not just the "id absent" assertion removed) to reflect the new full expected array, since that same test's fixture HTML already contained `id="hero"`.
- Pseudo-state variant keys from `parseCss` are shaped `"<breakpoint>_<state>"` (e.g. `"main_hover"`, `"medium_hover"`). Mapped by taking everything after the first `_` as the state and looking it up in a `PSEUDO_STATE_TO_WEBFLOW` map (`hover`→`hover`, `focus`→`focused`, `pressed`/`active`→`pressed`, `placeholder`→`nthChild`). Any variant key that is neither a known breakpoint nor a known pseudo-state now produces a warning (`variant "X" on .Y does not map to a Webflow state — skipped`) instead of being silently dropped, per the spec's "Unrecognized pseudo-states emit a warning and are skipped."
- `buildStyles` signature gained an optional `warnings: string[] = []` parameter so it can report unmapped pseudo-states; `emitWebflow` now passes its own `warnings` array through so those warnings surface in `EmitResult.warnings` like all other warnings in this module.
- Added `type: "@webflow/XscpData"` to the `XscpData` interface (not `XscpPayload`) and to the literal returned by `emitWebflow()`, exactly matching the spec's Fix 1 pseudocode nesting (`{ type, payload: { nodes, styles, assets, ix1, ix2 } }`).

## Out-of-scope work needed
- **Found significant pre-existing, uncommitted, concurrently-modified changes in `lib/webflow-converter/convert.ts`, `lib/webflow-converter/validator.ts`, and `lib/webflow-converter/convert.test.ts`** that are NOT part of this feature's scope (`Touches: emit.ts` only) and were not authored by this worker. These changes were observed actively re-appearing in the working tree during this session (confirmed via repeated `git diff` polling), indicating another worker is running concurrently in the same working tree. A prior worker (F077, commit `4384b6b7`) already flagged the same conflict in its handoff.
  - `validator.ts`'s in-progress change checks `payload.type !== EXPECTED_TYPE` on the **`XscpPayload`** parameter (the inner `payload.payload` object) rather than the outer `XscpData` object that actually carries `type`. Since `XscpPayload` never has a `type` field, this check will always fail once that WIP is committed as-is, and currently causes 17 failures in `convert.test.ts`/`validator.test.ts` (not `emit.test.ts`) when running the full `lib/webflow-converter/` suite.
  - `convert.ts`'s in-progress change appears to target AS-089 (merge inline `<style>` into CSS parsing) and AS-051 (warn on unused CSS classes) — unrelated to F076.
  - I deliberately left these files untouched (matching F077's precedent) since they are outside my `Touches` scope and actively being written by another process; touching them risked losing that other worker's in-progress work or causing a merge conflict.
  - **Suggested follow-up for the orchestrator:** once the concurrent worker (likely working on AS-089/AS-051, and possibly also independently on AS-111/AS-117 validation) finishes and commits, re-run `npx vitest run lib/webflow-converter/` and fix the `validator.ts` bug where it checks `.type` on the wrong payload level (should check `(payload as unknown as { type?: unknown }).type` is not the right approach either — the validator's `validatePayload(payload: XscpPayload)` signature would need to change to accept the outer `XscpData`, or the type check needs to move to a separate wrapper/caller, e.g. `convert()`, that has access to the outer envelope).

## Blockers
(none — Status is COMPLETE for this feature's own scope)

## Autonomous decisions
AUTONOMOUS_DECISION: Changed `WebflowStyle.comb`'s stored value from a class-name string to the base style's `_id`, since the spec's own Fix 2 pseudocode only works if `comb` holds an `_id` matchable via `styleArray.find(s => s._id === style.comb)`. This is a necessary correction to make the literal spec'd second pass functional, not a deviation from intent.
AUTONOMOUS_DECISION: For multi-level combo chains (e.g. `.a.b.c`), used the *immediate* preceding chain member (`comboOf[comboOf.length - 1]`, i.e. `"b"`) as the base for `comb`/`children`, rather than the first chain member (`"a"`). The spec's example and test only cover a two-level combo (`.card.is-featured`) where these are identical; immediate-parent chaining is the more defensible generalization and was not specified otherwise.
AUTONOMOUS_DECISION: `id` xattr entries are placed first in the `xattr` array (via `unshift`), ahead of `data-*` entries, since that matches natural source attribute order for the common case and there was no explicit ordering requirement in the spec.

## Notes for the next worker
- `emit.test.ts` passes 17/17 in complete isolation (`npx vitest run lib/webflow-converter/emit.test.ts`). All failures seen when running the full `lib/webflow-converter/` directory are in `convert.test.ts` and `validator.test.ts`, caused by unrelated concurrent in-flight work described above — not by this feature's changes.
- `npx tsc --noEmit` and `npm run lint` both pass cleanly across the whole repo (including the concurrently-dirty files), so there are no type or lint regressions from either this feature or the concurrent WIP.
- If the orchestrator wants a fully green `lib/webflow-converter/` suite immediately, the fastest unblock is to either (a) wait for/merge the concurrent worker's commit and then fix the `validator.ts` type-check level bug described above, or (b) `git stash`/discard the concurrent WIP in `convert.ts`/`validator.ts`/`convert.test.ts` if it turns out to be abandoned/orphaned work with no owning feature.
