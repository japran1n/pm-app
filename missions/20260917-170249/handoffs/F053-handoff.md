# Handoff: F053 — Combo class chain model fix

## Status
COMPLETE

## Assertions covered
AS-039: PASS — standalone `.b{color:red}` and combo `.a.b{color:blue}` now produce two distinct class-map entries (verified both orderings: standalone-then-combo and combo-then-standalone) in `test_AS_039` tests in css.test.ts
AS-040: PASS — three-deep chain `.a.b.c` yields `comboOf: ["a", "b"]` on a key-`"a|b|c"` entry, and same terminal class under two different bases (`.x.z`, `.y.z`) produce distinct combo entries keyed `"x|z"` / `"y|z"` — verified in css.test.ts

## Files changed
lib/webflow-converter/css.ts
lib/webflow-converter/css.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 172 tests passed
`npx tsc --noEmit -p .` (0) — no new type errors in lib/webflow-converter

## Decisions made
- Used a pipe-separated chain key (`"a|b"`, `"a|b|c"`) for combo class map entries, distinct from the standalone key (bare class name), exactly as specified in the feature spec.
- Kept `ensure()` registering every individual chain member as its own standalone entry too (unchanged behavior from before) — this is needed so `.a` and `.b` exist as classes in Webflow even if the CSS never declares them alone, and is independent of the combo-bucket-collision bug being fixed.
- `ParsedClass.name` remains the terminal class name (e.g. `"b"` for both the `"b"` standalone entry and the `"a|b"` combo entry) — the map key carries the chain identity, `.name` carries the Webflow class name to apply.
- `comboOf` changed from `string | null` to `string[] | null` per spec; order preserved as source order of the chain (all members except the terminal one).
- No downstream code (F018 emitter) currently reads `comboOf` yet (verified via grep — only css.ts/css.test.ts reference it), so no other files needed updates for this shape change.

## Out-of-scope work needed
- The F018 style emitter (referenced in the spec as "downstream emitter") does not yet exist / does not yet consume `classes` map's `comboOf`/combo keys. When it is implemented or touched next, it must be written against this new `comboOf: string[]` chain-key shape (map keys are `"a|b"` style for combos, not just terminal names) — flagging this so the next worker building/touching the emitter knows the current contract.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to still register every individual chain member as a standalone map entry (in addition to the new combo-keyed entry) even when that member is never declared standalone in the CSS (e.g. `.z` in `.x.z`/`.y.z` only appearing inside combos). This preserves prior behavior of guaranteeing that `.x`, `.y`, `.z` all exist as classes in the Webflow class list, and is consistent with the spec's requirement that same-terminal-class-under-different-bases test case still resolves `result.classes.get("z")` to an existing (empty) entry.

## Notes for the next worker
No MCP tools were used — this is a pure library/unit-test fix with no external service touched. The fix is entirely in `lib/webflow-converter/css.ts` (`parseSelector` chain output was already full chain in source order; only the class-map keying/`comboOf` shape needed to change) and its tests in `lib/webflow-converter/css.test.ts`.
