# Handoff: M7 followup — Link type (no LinkBlock) + eventIds Link-only

## Status
COMPLETE

## Assertions covered
No new assertion IDs assigned to this fix (ground-truth-shape regression fix
requested directly by orchestrator to unblock Designer paste). Existing
wf.json-shape assertions (AS-082, AS-083, AS-111, AS-114, AS-119 and the
end-to-end convert.test.ts ground-truth regression test) continue to pass
with the corrected shape.

## Files changed
lib/webflow-converter/typemap.ts
lib/webflow-converter/emit.ts
lib/webflow-converter/validator.ts
lib/webflow-converter/typemap.test.ts
lib/webflow-converter/emit.test.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run lib/webflow-converter/ components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts` (0, 20 files / 562 tests passed)
`npm run lint` (0)

## Decisions made
- Superseded the previous (incorrect) fix recorded in this same handoff file:
  that attempt added `eventIds` to the *common* key set (every node type) and
  kept a separate `"LinkBlock"` node type. Re-inspecting the ground-truth
  `wf.json` `Link` nodes directly showed **Webflow has no `LinkBlock` type at
  all** — every `<a>` is `type: "Link"`, with `data.block` (`""` inline /
  `"block"` block) carrying the distinction the converter used to express via
  a separate type. This was the actual root cause of the Designer
  `Object.hasOwn` crash: Webflow's element-definition lookup found nothing
  for `"LinkBlock"`.
- `typemap.ts`: `<a>` always returns `{ type: "Link", tag: "a", data: { link, block } }`;
  `hasElementChildren` still decides `block: "block"` vs `block: ""` + `text: true`,
  same rule as before, just expressed through `data.block` instead of `type`.
- `emit.ts`: removed the `"LinkBlock"` case from `buildNodeData` entirely (dead
  code once typemap never emits that type). The `Link` case now sets
  `eventIds: []` explicitly (not via the common spread) since ground truth
  shows `eventIds` appears only on Link nodes.
- `commonNodeData()` reverted to the six keys ground truth actually shares
  across all element types (`devlink, displayName, attr, xattr, search,
  visibility`) — `eventIds` removed from it. Verified Section, Block, Heading,
  Paragraph, Image data shapes against wf.json key-for-key (Paragraph
  correctly has no `tag`; Image never had `eventIds` and unaffected).
- `validator.ts`: removed `"LinkBlock"` from `KNOWN_TYPES`; removed
  `"eventIds"` from `COMMON_DATA_KEYS`; added a targeted check that any node
  with `type === "Link"` must carry `eventIds` in its data, matching the
  narrower ground-truth rule instead of a blanket common-key requirement.
- Grepped the whole repo for `"LinkBlock"` literals after the change — only
  remaining hits are the explanatory comment in typemap.ts and this handoff's
  own prose; no code or test references the string as a value anymore.

## Out-of-scope work needed
None identified — this was a narrowly scoped crash-source fix per the task
description.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named this handoff `M7-eventids-linkblock-fix-handoff.md`
(not `F<NNN>`) since the task was assigned directly by the orchestrator
outside the numbered feature-spec flow, following the existing convention of
other ad-hoc `M7-*-handoff.md` files already present in this mission's
handoffs directory for similar ground-truth-parity fixes. Overwrote the
previous draft of this same file in place since it documented an approach
this task explicitly corrects.

## Notes for the next worker
- Ground truth reference used: the three `Link` nodes inside
  `/private/tmp/claude-501/.../scratchpad/wf.json` (copied out of Webflow
  Designer, `<a>` elements with no element children). Each has
  `type: "Link"`, `data.block: ""`, and the key set
  `link, block, text, button, eventIds, attr, devlink, displayName, xattr,
  search, visibility` — no node in the captured payload anywhere used the
  string `"LinkBlock"`.
- If Designer paste still crashes after this fix, capture a fresh wf.json
  with a *block*-mode link (a link wrapping element children, e.g. a card
  linking a whole `<div>`) to confirm `data.block === "block"` is the only
  distinguishing signal Webflow expects for that case — this fix assumes it
  based on the shared `Link` type definition but the ground-truth sample only
  contained inline links.
