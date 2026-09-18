# Handoff: F016 — html typemap links forms button

## Status
COMPLETE

## Assertions covered
AS-082: PASS — `<a>` with only text content converts to Webflow Link (test_AS_082_a_with_text_only_converts_to_link, test_AS_082_a_with_href_target_rel_carries_link_data)
AS-083: PASS — `<a>` with element children converts to Webflow Link Block (test_AS_083_a_with_element_children_converts_to_link_block)
AS-084: PASS — `<button>` converts to a Webflow Button-equivalent (Link/a) with a warning about becoming a real Submit button inside a form (test_AS_084_button_converts_to_link_button_with_warning)
AS-085: PASS — `<form>`/`<input>`/`<textarea>`/`<select>` convert to a plain Block with a warning that Webflow form elements must be rebuilt in the Designer (test_AS_085_form_converts_to_block_with_warning, test_AS_085_form_control_descendants_convert_to_block_with_warning)

## Files changed
lib/webflow-converter/typemap.ts
lib/webflow-converter/typemap.test.ts

## Commands run
`npx vitest run lib/webflow-converter/typemap.test.ts` (0) — 18 passed (10 pre-existing + 8 new)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Followed the feature spec and its clarification file exactly (byte-for-byte port of the prototype's `mapTag()` a/button/form branches from `~/Desktop/html-to-webflow/src/typemap.mjs`), rather than the more elaborate FormTextInput/FormCheckbox/FormButton typed-input scheme described in the orchestrator's task message. The spec's own "Draft scope" and the validation-contract text for AS-082..AS-085/AS-133 both describe the simpler Link/LinkBlock/Button/plain-Block-with-warning behavior, which is what the prototype actually implements and what the assertions test for. Treating the clarified spec + validation contract as source of truth per instructions.
- Extended `getWebflowType(tagName, ctx?)` with an optional `WebflowTypeContext` (`hasElementChildren`, `attrs`) matching the prototype's `mapTag(tag, ctx)` signature, keeping the existing single-argument call sites (used by earlier structural tags) working via a default `{}`.
- Added an unexported `linkData()` helper (byte-for-byte port) to build the `data.link` shape (`url`, `target`, `mode: 'external'`) shared by both `<a>` and `<button>` mappings.
- `<input>`/`<textarea>`/`<select>` share the same case-fallthrough as `<form>` (all become `Block`/`div` with the same rebuild warning), matching the prototype and satisfying AS-085/AS-133 without introducing per-input-type variants that the spec/assertions don't call for.

## Out-of-scope work needed
- None identified for this feature's scope. Note: while working, another concurrent worker (apparently a later feature, e.g. img/svg handling) was also editing `lib/webflow-converter/typemap.ts` in parallel and added an `outerHTML` field to `WebflowTypeContext` plus img/svg cases; that work is not mine and is already reflected in the committed file since I re-ran tests/tsc after noticing the concurrent edit and everything still passed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Ignored the task message's detailed FormTextInput/FormCheckbox/FormButton/input-type-specific spec in favor of the feature spec + clarification + validation-contract's simpler "form controls become a warned plain Block" behavior, since the spec is the source of truth and the prototype/tests corroborate it (AS-085, AS-133 explicitly say the converter does not attempt real Webflow form-element construction in v1).

## Notes for the next worker
- Reference prototype: `~/Desktop/html-to-webflow/src/typemap.mjs` — the `a`/`button`/`form` branches were ported verbatim (case values, warning strings, `linkData()` logic).
- `getWebflowType` now takes an optional second argument `{ hasElementChildren?, attrs? }`; callers building the DOM walk (elsewhere in the converter pipeline) will need to pass `hasElementChildren` (whether the node has any Element children, not just text nodes) and `attrs` (the tag's HTML attributes) for `<a>`/`<button>` to get correct output — omitting it defaults to `hasElementChildren: false, attrs: {}`, which is safe but always emits `Link` never `LinkBlock` and href `#`.
