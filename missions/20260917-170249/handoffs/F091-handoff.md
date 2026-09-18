# Handoff: F091 — fix AS-116/AS-118 blocker — duplicate style name for combo terminal class matching a standalone class name

## Status
COMPLETE

## Assertions covered
AS-116: PASS — `convert('<div class="btn primary">x</div>', '.btn.primary{color:red}')` now returns exactly one style named "primary" (the combo, comb !== "", styleLess "color: red;") and zero errors. Verified with new test `AS-116: combo .btn.primary produces exactly one style named primary — the combo, not a phantom standalone`.
AS-118: PASS — no duplicate style entries are produced for a combo terminal class that also happens to match no standalone rule. Also verified the legitimate two-style case (`.primary {}` + `.btn.primary {}`) still yields two distinct, correctly-shaped styles via new test `AS-116: when both .primary and .btn.primary exist, two primary styles are valid — one standalone one combo`.

## Files changed
lib/webflow-converter/css.ts
lib/webflow-converter/css.test.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 386 passed, 9 files passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Implemented the fix exactly as specified: changed `for (const c of chain) ensure(c, c, null)` to `for (let i = 0; i < chain.length - 1; i++) ensure(chain[i], chain[i], null)` in `parseCss`'s rule-walking loop. This registers all non-terminal chain members as standalone phantoms (needed as bases for combos) but skips the terminal member, which is only registered as a standalone if it has its own explicit `.terminal {}` rule elsewhere in the CSS (handled naturally since that rule's own walk call re-invokes `ensure` for it as the terminal of its own single-element chain).
- Skipped the validator.ts name-uniqueness check described in the initial task draft, per the task's own "Revised approach" — a standalone and a combo can legitimately share the same `name` (distinguished by `comb`), so a strict name-uniqueness check would be a false positive. The existing duplicate `_id` check in validator.ts remains sufficient defence; this feature's real fix is at the source (css.ts) so the phantom duplicate is never created in the first place.
- Updated three pre-existing `css.test.ts` assertions (`AS-040` suite) that had encoded the old buggy behavior as expected behavior (asserting the terminal class of a combo chain WAS registered as a standalone, e.g. `result.order` including `"is-featured"`, `result.classes.has("c")` being true, `result.classes.get("z")!.base` being defined). These are the exact tests that would have caught this bug had they asserted the correct spec originally. Updated them to assert the terminal class is NOT registered as a phantom standalone, matching AS-116's requirement.

## Out-of-scope work needed
None identified — the fix is self-contained to css.ts's rule-walking loop, and the two existing consumers (validator.ts, convert.ts/emit.ts) required no changes since they already worked correctly off of whatever `parseCss` produced.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not add the validator.ts name-uniqueness check suggested in an earlier draft of the task instructions, because the same task document's own "Revised approach" section concluded it would produce false positives on the legitimate standalone+combo-same-name case, and superseded that step with "Skip the validator change." Followed the final instruction.

## Notes for the next worker
- The root cause was in `lib/webflow-converter/css.ts`, `parseCss()`, in the per-selector rule-walking loop (~line 172 before fix). Every member of a class chain (e.g. `.btn.primary` → `["btn", "primary"]`) was being registered as its own standalone class via `ensure(c, c, null)`, including the terminal member which should only ever be a combo entry unless it has its own dedicated CSS rule.
- No MCP tools were used — this is a pure algorithmic/parsing fix with no external service dependency.
