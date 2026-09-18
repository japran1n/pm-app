# Handoff: M7 — Fix Designer paste crash by emitting root-level `meta`

## Status
COMPLETE

## Assertions covered
No new assertion IDs were assigned for this task; it is a targeted crash fix
against existing behaviour (AS-111/AS-112/AS-114/AS-116/AS-117/AS-118/AS-119,
which govern payload/envelope validity). All were re-verified green after the
change.
AS-111: PASS — emitted payload still carries type "@webflow/XscpData"
AS-112: PASS — payload.nodes non-empty still enforced
AS-114: PASS — class id resolution unaffected
AS-116: PASS — duplicate style _id detection unaffected
AS-117: PASS — combo registration checks unaffected
AS-118: PASS — null nodes/styles rejection unaffected
AS-119: PASS — errors still always block; new meta errors integrate into the same block path

## Files changed
lib/webflow-converter/emit.ts
lib/webflow-converter/emit.test.ts
lib/webflow-converter/validator.ts
lib/webflow-converter/validator.test.ts
lib/webflow-converter/convert.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run lib/webflow-converter/ components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts` (0, 566 tests passed / 20 files)
`npm run lint` (0)

## Decisions made
- **Root cause, experimentally confirmed**: the Webflow Designer paste crash
  (`TypeError: Cannot convert undefined or null to object at Object.hasOwn
  ... at pasteAttempted`) is caused by a missing top-level `meta` object in
  our clipboard envelope. A real Designer-produced payload (captured in
  `/private/tmp/.../scratchpad/wf.json`, top-level keys exactly `type`,
  `payload`, `meta`) pastes fine; the identical payload with `meta` stripped
  reproduces the exact crash. Independently, every real Designer capture in
  public corpora (finsweet/hacks, darknoon/layer-formats,
  systemflowco/scripts) has `meta` as a SIBLING of `payload`, never nested
  inside it.
- Added `meta` to the `XscpData` interface as a **required** field
  (`XscpMeta`), not `Record<string, unknown>`, so any future caller that
  forgets it gets a compile error, not a silent runtime crash. Exported
  `DEFAULT_XSCP_META` as the single source of truth for the fixed values
  emit.ts writes.
- Deliberately **excluded `sourceSiteId`** from the emitted meta — it
  identifies a specific Webflow site (captured from whichever Designer
  session produced the ground-truth file) and is not something this
  converter can legitimately produce.
- `validator.ts`'s `validatePayload()` already used a "duck-typed" flattened
  object as its input (see its pre-existing `type` handling and doc
  comments) rather than the true nested `XscpData` envelope — `convert.ts`
  spreads `payload.payload` plus `type` into one flat object before calling
  it. Kept this existing convention for `meta` rather than introducing a
  second, inconsistent validation entry point: `convert.ts` now also spreads
  `meta` into that same flattened object, and `validateMeta()` duck-types it
  off that object the same way `type` is checked. This was the smallest
  change consistent with the codebase's existing pattern and required no
  signature changes to `validatePayload`.
- Left `styleLess: ""` and `expandUserComponents: true` untouched per the
  task's explicit instruction — both are correct, verified by the same
  ground-truth experiment.

## Out-of-scope work needed
None identified. This was a scoped, self-contained fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `validatePayload`'s existing flattened/duck-typed
input shape (payload fields + `type` + now `meta` all spread into one
object) rather than refactoring it to accept the true nested `{ type,
payload, meta }` envelope directly. The existing code and its own doc
comments already establish this as the intended pattern for `type`; matching
it for `meta` avoids an unrequested, wider refactor of `convert.ts`'s and
`validator.ts`'s public interfaces while still closing the crash gap.

## Notes for the next worker
- Ground truth reference file used for this fix:
  `/private/tmp/claude-501/-Users-sasajapranin-Desktop-pm-app/029d550f-8214-473c-ba3e-02cc4e994106/scratchpad/wf.json`
  — top-level keys are exactly `type`, `payload`, `meta`. Worth re-checking
  against this file if the envelope shape is ever questioned again.
- No MCP tools were relevant to this fix (pure local TypeScript logic, no
  external service state).
