# Handoff: F080 — fu: s convert() validate() type wiring

## Status
PARTIAL

## Assertions covered
AS-111: PARTIAL — `payload.type` is now correctly propagated from `emit.ts`'s `XscpData` envelope into `validatePayload`, so the "payload.type must equal @webflow/XscpData" error no longer fires for well-formed input. 7 of the 9 originally-failing `convert.test.ts` tests now pass. 2 of the 9 still fail, but for reasons unrelated to the type field — see Blockers.

## Files changed
lib/webflow-converter/convert.ts

## Commands run
`npx vitest run lib/webflow-converter/` (1) — 2 failing (down from 9), 344/346 passing
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Used the minimal alternative offered in the spec: `validatePayload({ ...emitResult.payload.payload, type: emitResult.payload.type })` in `convert.ts`, rather than changing `validatePayload`'s signature in `validator.ts`. This matches the pattern `validator.test.ts` itself already uses (`{ ...payload, type: WEBFLOW_TYPE } as XscpPayload`), so `validator.ts` needed no changes and the fix stays a one-file, low-risk diff.
- Added `as XscpPayload` on the spread object because `XscpPayload` (declared in `emit.ts`) does not itself declare a `type` field — same cast pattern already present in `validator.test.ts`. Without the cast, `tsc --noEmit` fails with TS2353 ("type does not exist in type XscpPayload").

## Out-of-scope work needed
Two `convert.test.ts` tests remain red after this fix, but for reasons unrelated to AS-111 / the type-wiring bug this feature targeted:

1. `convert > converts HTML only (no CSS) into a valid payload` — fails with `Node ... references class "wrapper" with no matching style definition`. `emitWebflow` (emit.ts) emits a structural `wrapper` class on nodes even when no corresponding style/CSS class exists, and `validatePayload`'s AS-114 class-name check (validator.ts `walkNodes`) then flags it as an error. Needs either emit.ts to stop emitting classes with no backing style, or validator.ts's AS-114 rule to tolerate structural classes with no style definition.
2. `convert > empty HTML string returns an empty (not null/undefined) valid payload` — fails with `payload.nodes must not be empty`. `validatePayload` (validator.ts, around the `payload.nodes.length === 0` check) unconditionally errors on an empty `nodes` array, but this test asserts that converting empty HTML must yield a *valid* payload with `nodes: []`. Needs validator.ts's empty-nodes rule to be reconciled with this expectation (e.g. only error on empty nodes when the payload wasn't produced from empty input, or drop that error rule entirely).

Both are pre-existing bugs already present before this feature (confirmed by running the failing tests against the pre-fix code: each had a duplicate/independent failure reason in addition to the type-field message). They are outside this feature's scope, which per the clarified spec was limited to the `convert.ts` → `validatePayload` type-wiring call.

## Blockers
BLOCKER: 2 of the 9 tests this feature was expected to turn green remain failing, for reasons independent of the type-envelope wiring bug this feature targeted.
TRIED: Verified via `git stash` that both tests fail against the pre-fix code for two separate reasons each (the type-mismatch error AND a second, unrelated error). After the fix, only the second, unrelated error remains for each.
NEEDED: A follow-up feature to (a) reconcile emit.ts's `wrapper`-class emission with validator.ts's AS-114 class-existence check, and (b) reconcile validator.ts's "payload.nodes must not be empty" rule with the "empty HTML converts to an empty-but-valid payload" contract in convert.test.ts.
SUGGESTED FOLLOWUP: Fix two remaining pre-existing convert.test.ts failures unrelated to AS-111: (1) `emitWebflow` in emit.ts emits a `wrapper` class on the root node with no matching style/CSS definition, which validator.ts's AS-114 walkNodes check then flags as `references class "wrapper" with no matching style definition` — decide whether emit.ts should stop emitting unstyled structural classes or whether validator.ts's AS-114 check should exempt classes it knows are structural/auto-generated. (2) validator.ts's `validatePayload` unconditionally errors when `payload.nodes` is an empty array (`payload.nodes must not be empty`), but convert.test.ts's "empty HTML string returns an empty (not null/undefined) valid payload" test expects `convert("", "")` to return `errors: []` and `payload.payload.nodes: []` — decide whether this validator rule should be removed, made conditional, or whether convert.ts should special-case empty input before calling validatePayload.

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the "minimal alternative" (spread `type` into the payload argument, cast as `XscpPayload`) over changing `validatePayload`'s signature, per the spec's own guidance ("Either approach is acceptable — choose whichever keeps the code clearest") and because `validator.test.ts` already exercises `validatePayload` via this exact spread-and-cast pattern, so changing the signature would have required also rewriting the existing test file, which is out of this feature's declared scope (convert.ts wiring only).

## Notes for the next worker
No MCP usage — this is a pure library bug fix with no external service involvement. Run `npx vitest run lib/webflow-converter/convert.test.ts` to see the current 2 remaining failures directly; both have clear, single-line error messages pointing at the exact validator/emit rule in conflict.
