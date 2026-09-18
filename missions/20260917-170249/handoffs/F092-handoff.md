# Handoff: F092 — Fix AS-116 (duplicate style name) and AS-117 (unparented combo) blockers from M3-scrutiny-8

## Status
COMPLETE

## Assertions covered
AS-116: PASS — validator now errors on any two styles sharing a `name` (ambiguous class reference resolved by name at validator.ts:83-86). Verified with new tests in validator.test.ts and convert.test.ts covering `.btn{} .primary{} .btn.primary{}` and similar duplicate-name shapes.
AS-117: PASS — emit.ts now skips emitting an unparented combo style entirely (pushes to `warnings` and `continue`s before `styles.push()`), instead of emitting it with `comb: ""`, which previously made it look like a valid standalone style and bypassed the validator's `if (style.comb)` parenting check.

## Files changed
lib/webflow-converter/validator.ts
lib/webflow-converter/emit.ts
lib/webflow-converter/emit.test.ts
lib/webflow-converter/validator.test.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 9 test files, 387 tests passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Fix 1 (validator.ts): Added a `seenNames` Map keyed by style name, appended right after the existing duplicate-`_id` check inside `validateStyles`. Any second style with the same `name` produces an error referencing both `_id`s. This directly addresses the root cause noted in the spec: `validator.ts` resolves node class references by `name` (line 83-86: `if (!styleNames.has(cls))`), so two styles sharing a name is inherently an ambiguous reference regardless of how the duplication arose (real standalone + combo terminal, or multiple combo chains landing on the same terminal class name).
- Fix 2 (emit.ts): Changed the un-parented-combo-base branch in `buildStyles` from `warnings.push(...)` (informational, non-blocking) to `warnings.push(...); continue;` — the `continue` happens before `styles.push()`, so the malformed style (which would otherwise carry `comb: ""` and look like a legitimate standalone) is never added to the `styles` array. Since `continue` happens before the push, the second pass that populates `children` also never encounters this entry, so no dangling reference is created. Kept the message on `warnings` (not `errors`) per the spec's exact instruction, since a downstream `AS-114` validator error (unresolved class reference) is expected to catch the resulting broken payload at the `convert()` level whenever the skipped combo's class was actually referenced by a node — the emit-level skip is only about output correctness, not user-facing blocking (that's `validator.ts`'s job).
- Updated `emit.test.ts`'s existing test (previously named `test_AS_117_combo_with_missing_base_emits_warning_and_has_no_comb`, asserting `comboABC.comb === ""`) to `AS-116: combo class with undefined base emits a warning and is skipped from output`, asserting the style is `undefined` in the output array instead.
- Updated `convert.test.ts`'s pre-existing test `AS-116: when both .primary and .btn.primary exist, two primary styles are valid — one standalone one combo` — this test encoded exactly the bug being fixed (asserted two same-named styles were acceptable). Replaced it with the spec's Fix 3 test asserting `result.payload` is `null` and `result.errors` contains a duplicate-style-name message for that exact input shape.

## Out-of-scope work needed
None identified — the two blockers were narrowly scoped emitter/validator changes and are now closed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No F092 feature spec file exists under `missions/20260917-170249/features/`; this task was driven entirely by the explicit scrutiny-round instructions in the prompt (round 8 blockers B-1/AS-116 and B-2/AS-117), which fully specified the exact code changes and test additions. Followed those instructions verbatim, including updating two pre-existing tests that encoded the now-fixed buggy behavior, since leaving them in place would make the suite contradict the fix.

## Notes for the next worker
- No MCP tools were used — this is a pure library/logic fix with no external service touched.
- `buildStyles` in `lib/webflow-converter/emit.ts` has a two-pass structure: pass 1 builds `styles[]` and computes `comb`, pass 2 walks `styles` again to populate each base's `children[]`. The `continue` for unparented combos must happen in pass 1 before `styles.push()` — confirmed this by reading the full function before editing, as instructed.
- `validatePayload` in `lib/webflow-converter/validator.ts` takes a flat `XscpPayload` (i.e., `payload.styles`, `payload.nodes` directly), not a nested `{ type, payload: { styles, nodes } } }` shape — the `type` field is attached separately via a duck-typed cast in `convert.ts` (`{ ...emitResult.payload.payload, type: emitResult.payload.type }`). Test helpers `makePayload`/`makeStyle`/`makeNode`/`withType` in `validator.test.ts` reflect this; used them for the new AS-116 test rather than hand-rolling a payload shape.
