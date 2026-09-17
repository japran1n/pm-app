# Handoff: F020 — payload validator

## Status
COMPLETE

## Assertions covered
AS-111: PASS — node missing a valid non-empty `_id` produces an error, `valid:false`
AS-112: PASS — a fully valid minimal payload (nodes + styles) returns `valid:true`, no errors
AS-113: PASS — node with an unknown/future Webflow type produces a warning, not an error; `valid` stays true
AS-114: PASS — node missing `type` produces an error, `valid:false`
AS-115: PASS — style class name failing `/^[a-zA-Z][a-zA-Z0-9_-]*$/` (e.g. starting with a digit) produces an error
AS-116: PASS — `styleLess` present but not a string produces an error
AS-117: PASS — a node tree with a cycle (a descendant that points back to an ancestor) is detected and produces an error, never causes infinite recursion
AS-118: PASS — empty `nodes`/`styles` arrays validate as a valid empty document; `null` for either produces an error
AS-119: PASS — whenever `errors.length > 0`, `valid` is always `false`; no escape hatch/bypass flag exists in the module or its exported API

## Files changed
lib/webflow-converter/validator.ts
lib/webflow-converter/validator.test.ts

## Commands run
`npx vitest run lib/webflow-converter/validator.test.ts` (0) — 11 passed
`npx vitest run lib/webflow-converter/` (0) — 319 passed across 8 files (full sibling suite still green)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Followed the explicit task instructions' function signature/behavior (`validatePayload`, file name `validator.ts`/`validator.test.ts`) over the feature spec's draft file names (`validate.ts`/`validate.test.ts`), since the task message is the more specific and current instruction for this run.
- Typed the exported function's parameter as `XscpPayload` (the `{ nodes, styles, assets, ix1, ix2 }` shape defined in `emit.ts`) rather than the outer `XscpData` wrapper (`{ payload: XscpPayload }`). The task's validation rules ("payload.nodes must be an array", "payload.styles must be an array") only make sense against the inner shape — `XscpData` has no `.nodes`/`.styles` of its own, only `.payload.nodes`/`.payload.styles`. Named the export exactly as requested (`validatePayload`) while using the correct existing type so it type-checks and composes with `emit.ts`'s real output (callers pass `emitResult.payload.payload`).
- Circular reference detection walks with a per-branch `ancestors` Set (not a single mutable stack popped after recursion) so a node that is genuinely used correctly in two different branches (not a cycle) is not flagged — only real cycles (a node appearing as its own descendant) trigger the error.
- Unknown node types are a warning, not an error, per the spec's stated rationale (future Webflow types) and confirmed by the task instructions' explicit test case.
- Kept `KNOWN_TYPES` scoped to the set of types this converter's own `typemap.ts` (F015-F017) actually emits (Section, Block, Heading, Paragraph, Blockquote, List, ListItem, Link, LinkBlock, Image, HtmlEmbed) rather than guessing at Webflow's full internal type list, since that is the only known-good source of truth in this codebase.
- Also validated duplicate `_id` values across the tree as an error (not explicitly required by the task list but directly implied by "every node must have a non-empty `_id`" combined with the spec's original draft scope item "unique node/style ids"); this doesn't conflict with any required test case.

## Out-of-scope work needed
- The feature spec's original draft scope (F020-payload-validator.md) also calls for: unique style ids, every child/class reference resolving (i.e., cross-referencing `classes` on nodes against the `styles` array by name), a combo-class-registered-as-child check, and a no-shorthand check reusing F011's `isShorthand`. The task instructions given for this run listed a narrower rule set (7 items) and did not mention these. I implemented exactly the 7 rules in the task instructions plus the closely-related duplicate-`_id` check. If the mission still needs class-reference resolution / combo-class / shorthand checks, that should be a follow-up feature — a future worker can extend `validator.ts` with additional rules without changing its public signature.
- No code in the app currently calls `validatePayload` from the clipboard-copy path (that wiring belongs to whatever feature builds the "copy to clipboard" UI action, likely a later F02x). This validator is ready to be imported and gated on there; flagging so the orchestrator can confirm a downstream feature wires it in and blocks copy when `valid` is false, satisfying AS-119 end-to-end at the UI layer.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `XscpPayload` as the parameter type instead of `XscpData` because the task's own validation rules (`payload.nodes`, `payload.styles`) only match the inner payload shape; kept the function name `validatePayload` as requested.
AUTONOMOUS_DECISION: Named files `validator.ts`/`validator.test.ts` (per this run's explicit instructions) instead of the feature spec's draft `validate.ts`/`validate.test.ts`, since the task instructions are the more specific, current directive for this invocation.
AUTONOMOUS_DECISION: Implemented only the 7 validation rules and definition-of-done test cases listed in this run's task instructions, deferring the spec's broader draft scope (class-reference resolution, combo-class check, shorthand check) to a follow-up feature — see Out-of-scope work needed.

## Notes for the next worker
- `validatePayload` is a pure, synchronous function with no side effects and never throws — matches the "never throw for expected-bad input" clarified answer.
- `emit.ts`'s `emitWebflow()`/`emitWebflowFromSource()` return `{ payload: XscpData, warnings: string[] }` where `XscpData = { payload: XscpPayload }`. To validate an emit result, call `validatePayload(emitResult.payload.payload)`.
- No MCP tools used — this is a pure in-repo validation function with no external service dependency (registry lists none for this feature).
