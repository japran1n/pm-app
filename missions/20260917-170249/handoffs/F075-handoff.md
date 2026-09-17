# Handoff: F075 — complete payload validator

## Status
PARTIAL

## Assertions covered
AS-111: PASS (unit) — `validatePayload` rejects any payload missing/mismatching `type: "@webflow/XscpData"`; blocked end-to-end by an out-of-scope wiring gap in `convert.ts` (see Blockers).
AS-112: PASS — `validatePayload` rejects an empty `nodes` array with a specific error message; the old test asserting the inverse was deleted.
AS-114: PASS — every node `classes` entry must resolve to a known style's `name` (not `_id` — see Decisions made).
AS-116: PASS — duplicate style `_id`s are detected and reported.
AS-117: PASS — combo styles (`comb` set) must be registered in their base's `children` array; both "unknown base" and "not registered" cases are covered.
AS-118: PASS (unit, within validator scope) — every violation of AS-111–AS-117 produces `valid: false`; verified directly against `validatePayload`. Full end-to-end "never offered for copy" behavior through `convert()` is currently broken by the same out-of-scope wiring gap (see Blockers).
AS-119: PASS — `errors.length > 0` always implies `valid === false`, no override path exists in this module.

## Files changed
lib/webflow-converter/validator.ts
lib/webflow-converter/validator.test.ts

## Commands run
`npx vitest run lib/webflow-converter/validator.test.ts` (0, 19/19 pass)
`npx vitest run lib/webflow-converter/` (1, 337/346 pass — the 9 failures are all in `convert.test.ts`, outside this feature's scope; see Blockers)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- AUTONOMOUS_DECISION: The feature spec's sample code for Fix 3 (AS-114) suggested matching a node's `classes` entries against style `_id`s. Inspecting `emit.ts` showed `WebflowNode.classes` is populated straight from the HTML `class` attribute (class **names**, e.g. `"box"`), while `WebflowStyle._id` is an opaque generated id and `WebflowStyle.name` is the class name. Implemented AS-114 to resolve node classes against the set of valid style **names**, since that's the only way the rule can ever pass for a real payload. Verified this against `convert.test.ts`'s existing fixtures before finalizing.
- AUTONOMOUS_DECISION: The spec's Fix 1/Fix 2 pseudocode referenced `payload.payload.nodes` / `payload.payload.styles` (double-nested), implying `validatePayload` should take the full `XscpData` envelope (`{ type, payload }`). The actual call site in `convert.ts` passes only the inner `XscpPayload` (`emitResult.payload.payload`), and `convert.ts` was under active concurrent modification by another worker during this session (observed via `git log`/`git status` — commit `36dc33f8` landed mid-session and touched `emit.ts`'s `XscpData` interface to add a `type` field on the *outer* envelope). To avoid clobbering that in-flight work and to keep `validator.ts`'s exported signature compatible with the existing, unmodified call site, kept `validatePayload`'s parameter as the flat `XscpPayload` and implemented the `type` check via a duck-typed read (`(payload as { type?: unknown }).type`). This compiles cleanly against the current call site and is the minimal change that satisfies AS-111's unit-level contract.
- Restructured `validateStyles` into a single function that: (1) builds a style-id map while flagging duplicate `_id`s (AS-116), (2) builds the set of valid style names for AS-114, and (3) in a second pass validates name/styleLess/combo-registration (AS-117) using that map. This avoids duplicating the styles array traversal for each new rule.
- Per the spec, deleted the `"empty nodes array is a valid empty document"` test (asserted the inverse of AS-112) and replaced it with an `AS-112` describe block asserting the opposite.
- Renamed every test to reference the actual assertion it exercises per the validation contract (`missions/20260917-170249/validation-contract.md` lines 147-158). Several previously-mislabeled tests (circular-reference check, unknown-node-type warning, invalid class-name regex, styleLess type check) don't map to any AS-111–AS-120 assertion in the contract, so they were left as plain descriptive names rather than assigned an incorrect ID.
- Did not add "a `convert()` call returning that shape gives `payload: null`" tests wired through the real `convert()` function, because `convert.ts` is out of scope for this feature and (per the Blockers below) currently cannot produce a `payload.type` at all, which would make every such test fail for a reason unrelated to the rule under test. Instead, each new rule's "produces payload: null" requirement is covered by asserting `result.valid === false` directly against `validatePayload` (the function `convert.ts` uses to decide whether to null out `payload`), which is the unit actually owned by this feature.

## Out-of-scope work needed
`convert.ts` line ~60 calls `validatePayload(emitResult.payload.payload)`, passing only the inner `XscpPayload`. `emit.ts`'s `XscpData` envelope (as of commit `36dc33f8`, landed concurrently during this session) now stamps `type: "@webflow/XscpData"` on the **outer** wrapper (`emitResult.payload.type`), not on the inner payload. As a result, AS-111's new check in `validator.ts` will now correctly flag every real conversion as invalid (`payload.type must equal "@webflow/XscpData"`), because the `type` field never reaches `validatePayload`. This is visible as 9 new failures in `lib/webflow-converter/convert.test.ts` (not a file this feature is scoped to touch).

SUGGESTED FOLLOWUP: Update `convert.ts`'s call to `validatePayload(emitResult.payload.payload)` to also pass the envelope's `type`, e.g. `validatePayload({ ...emitResult.payload.payload, type: emitResult.payload.type })`, or change `validatePayload`'s signature to accept the full `XscpData` envelope and update the one call site accordingly. Either fix is a single-call-site change; re-run `npx vitest run lib/webflow-converter/` afterward — all 9 currently-failing `convert.test.ts` cases should go green with no further validator.ts changes needed.

## Blockers
BLOCKER: `convert.ts`'s single call to `validatePayload` doesn't pass through the `type` field that `emit.ts` now stamps onto the outer `XscpData` envelope, so every real `convert()` call now fails AS-111 validation even for well-formed input. This causes `lib/webflow-converter/convert.test.ts` (9 tests, a file outside this feature's scope) to fail.
TRIED: Considered widening `validatePayload`'s parameter to the full `XscpData` envelope and updating `convert.ts`'s one-line call site to match, which would fully close the gap. Held off because `convert.ts` and `emit.ts` were under active concurrent modification by another worker during this session (git history shows commit `36dc33f8` landing mid-task, and `validator.ts`/`validator.test.ts` themselves were twice reverted to their pre-task state by what looks like a concurrent git operation on the same working tree before settling) — editing `convert.ts` right now risks clobbering in-flight work outside this feature's assigned scope (`lib/webflow-converter/validator.ts` and `lib/webflow-converter/validator.test.ts` only, per the task instructions).
NEEDED: A follow-up feature (or the worker currently owning `convert.ts`/`emit.ts`) to update the one call site in `convert.ts` as described above.
SUGGESTED FOLLOWUP: Create a small follow-up feature: "Wire the XscpData `type` field through convert.ts's validatePayload call so AS-111 passes for real conversions." Scope: `lib/webflow-converter/convert.ts` only, one-line change at the `validatePayload(...)` call, plus re-running `lib/webflow-converter/convert.test.ts` to confirm all 9 currently-failing assertions (AS-051 unused-class warnings, general success-contract tests) pass again.

## Autonomous decisions
See "Decisions made" above (two AUTONOMOUS_DECISION entries: resolving AS-114 by style `name` instead of `_id`, and keeping `validatePayload`'s parameter shape flat/duck-typed rather than restructuring the `XscpData` envelope end-to-end).

## Notes for the next worker
- This repo's working tree had a second worker actively committing to `lib/webflow-converter/emit.ts` / `emit.test.ts` during this session (see commit `36dc33f8`, "fix(AS-111,AS-091,AS-117,AS-041): emit type envelope, combo children, id attrs, hover variants" — note its subject line also claims AS-111 and AS-117, overlapping this feature's assertions from the emit side). Worth checking with that worker's handoff (likely `F077`-ish) for what they changed in `emit.ts` around `XscpData.type` and combo `children` wiring, since it directly affects whether the `convert.ts` follow-up above is even still needed by the time you read this.
- `lib/webflow-converter/validator.ts` and `validator.test.ts` were, at least twice, silently reverted to their pre-edit contents between consecutive tool calls in this session (confirmed via re-reading the file and via `git status`/`grep` checks) — almost certainly caused by concurrent git activity on the same working directory from another worker process. If you see a similar "my edit disappeared" symptom, re-apply and immediately re-verify with `grep` before moving on, as done here.
- `validatePayload` now takes the flat `XscpPayload` shape (unchanged export signature) and duck-types the `type` field off it. If a future feature restructures the signature to take the full `XscpData` envelope, update `convert.ts`'s call site in the same change.
