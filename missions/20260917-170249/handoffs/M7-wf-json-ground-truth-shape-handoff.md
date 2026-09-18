# Handoff: M7 — emit.ts payload shape matches Webflow Designer's real clipboard format (wf.json)

## Status
COMPLETE

## Assertions covered
This task was assigned directly (not via a numbered F<NNN> spec) to fix a
structural mismatch between our emitted payload and a ground-truth payload
copied from Webflow Designer (`wf.json`), which was crashing Designer's
`pasteAttempted` handler (`Object.hasOwn` on `undefined`). It touches the
node/style shape produced by `emitWebflow()` and consumed across the whole
converter, so it affects most previously-assigned assertions for F018/F019/
F023/F076/F086/F088 and the M7 var()-fallback work — all of their existing
tests were updated in place to the new shape and still PASS (559/559 tests
green, see Commands run). No assertion behavior was intentionally changed;
only the wire shape of the payload.

## Files changed
lib/webflow-converter/emit.ts (rewritten: flat `payload.nodes`, `classes` as style `_id`s, text-node shape `{_id, text:true, v}`, `data` common-key set per node type, style field order + `origin`/`selector`, payload gains `expandUserComponents: true`)
lib/webflow-converter/validator.ts (rewritten to validate the flat structure: children-id resolution, classes-id resolution, common `data` keys, text-node shape, graph-based cycle detection over id references)
lib/webflow-converter/css.ts (removed `resolveVarFallback` and its helper — `var(--name, fallback)` now passes through `styleLess` verbatim, per wf.json)
lib/webflow-converter/convert.ts (updated "unused CSS class" warning logic to resolve style `_id`s back to class names via the styles array, since flat nodes no longer carry names directly)
lib/actions/webflow-converter.ts (`countNodes` simplified — `payload.nodes` is now flat, so it's just `.length`)
lib/webflow-converter/emit.test.ts (rewritten for the flat shape; added a "ground-truth shape conformance (wf.json)" describe block)
lib/webflow-converter/section-embeds.test.ts (rewritten to resolve child ids via a `byId()` helper)
lib/webflow-converter/validator.test.ts (rewritten: `makeNode`/`makeStyle`/`makePayload` fixtures updated to the new shape; added coverage for missing common `data` keys, text-node shape, children-id resolution, and the new graph-based cycle detection)
lib/webflow-converter/convert.test.ts (fixed node-count assertions for the now-flat array; added a dedicated ground-truth regression test asserting flat nodes, `classes` as resolvable style ids, common `data` keys on every element node, `expandUserComponents === true`, and `var()`-with-fallback passing through `styleLess` verbatim)
lib/webflow-converter/var-resolver.test.ts (deleted — tested the removed `resolveVarFallback` helper)

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run lib/webflow-converter/ components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts` (0, 559/559 passed)
`npm run lint` (0)

## Decisions made
- Internally kept a nested "tree" representation during the HTML walk (parent element holds its children inline, same as before) and added a final `flattenTree()` pass that emits pre-order DFS into the flat `payload.nodes` array — this matches wf.json's traversal order exactly (parent, then each child's full subtree, in source order) and let almost all of the existing recursive walk/CSS-embed/combo logic stay unchanged.
- `node.classes` (style `_id`s) resolution: built a `classNameIndex` from `buildStyles()`'s internal `key -> id` map (where `key` is `comboOf.join("|")` + terminal name, e.g. `"team_toggle-icon|is-active"`), then for each element's HTML class-name list (in source order) picked, per class name, the *longest* combo chain whose `comboOf` members are all present among that element's own class names — falling back to the standalone (non-combo) style for that name. This correctly reproduces wf.json's pattern where a single combo class (e.g. `is-active`) is emitted once and reused across many different base elements.
- Image node `data.attr.src`: kept the existing v1 decision of leaving `src` empty for manual re-upload (AS-095 through AS-100 in earlier features documented "no src wired up") while still adding the required wf.json-shaped keys (`img.id`, `srcsetDisabled`, `sizes`, `loading`, `width`, `height`) — this satisfies the structural crash fix without silently overriding those earlier assertions. Flagged here as an explicit choice rather than changed silently.
- Did not add an `expandUserComponents` hard-requirement to `validatePayload()` — the task's explicit ask was to update the validator for the flat-array/children/classes/data/text-node checks; `expandUserComponents` is exercised via the new regression test at the `convert()` level instead, to avoid changing validator pass/fail behavior for any payload built by hand in existing tests that predates this key.
- AS-113 (circular reference) can no longer be detected via object-identity ancestor tracking now that `children` are `_id` strings, not nested objects. Replaced it with a standard directed-graph DFS/recursion-stack cycle check over the id→children-ids adjacency built from the flat array — same user-observable guarantee (a self-referencing node tree is rejected), different implementation necessitated by the flat shape.

## Out-of-scope work needed
None identified — this was a self-contained structural fix confined to the emit/validate/convert layer already scoped by the task.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Left `Image` node's `attr.src` empty (manual-upload warning path) rather than wiring the real `src` attribute value through, even though wf.json's own Image node example does carry a real `src`. Reason: earlier features in this mission (AS-095 through AS-100) explicitly decided not to carry `src` through, and the task's explicit scope was the structural/key-shape fix (the crash cause), not a reversal of that behavior. Only the required key *shape* (`img`, `srcsetDisabled`, `sizes`, `loading`, `width`, `height`, `id`) was added.

## Notes for the next worker
- Ground-truth payload used for this fix lives at the path given in the task description (a scratchpad file, not checked into the repo) — if you need to re-diff against it, ask the orchestrator to re-supply it; it is not persisted in `missions/20260917-170249/`.
- `buildStyles()` now returns `{ styles, idByKey }` instead of a bare array — `idByKey`'s keys are pipe-joined combo chains (`"a|b"`) or bare names for standalone classes; this is the mechanism `emit.ts`'s `buildClassIndex()`/`resolveClassIds()` use to turn HTML class names into style `_id`s. Any future caller of `buildStyles()` needs to destructure the new return shape.
- `isTextNode()`'s discriminator changed from `node.type === "text"` to `node.text === true`, since flat text nodes no longer carry a `type` key at all (this was itself one of the required shape changes and is enforced by the validator).
