# Handoff: F094 — emit stub styles for classes with no CSS rule (AS-114 blocker fix)

## Status
COMPLETE

## Assertions covered
AS-114: PASS — every class referenced on a node now resolves to a style entry (real style or stub with `styleLess: ""`); `emitWebflow`/`convert` no longer reject documents with unstyled utility classes (e.g. `w-container`, `js-trigger`). Verified by `test_AS_114_*` tests in `emit.test.ts` and `convert.test.ts`, plus updated `AS-114`/`AS-119` tests in `convert.test.ts` that now assert non-null payload + empty errors instead of null payload.

## Files changed
lib/webflow-converter/emit.ts
lib/webflow-converter/emit.test.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 9 files, 389 tests passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Implemented Option B as instructed: `buildStyles()` runs unchanged, then `emitWebflow()` walks the final `nodes` tree with a new `collectClasses()` helper to gather every class name in use, and appends a minimal stub (`fake: false`, `comb: ""`, `styleLess: ""`, `variants: {}`, `children: []`) for any class not already present in the styles array. No warning is emitted for these — unstyled utility classes are normal in pasted Webflow markup.
- `validator.ts` was left untouched. Its per-node "class references unknown style" check (AS-114 guard) is still correct and still fires for genuinely malformed payloads (e.g. a hand-built payload with `styles` array missing an entry) — it's just unreachable via `emitWebflow`'s normal path now, which is the intended effect of this fix ("true by construction" rather than "enforced by rejection").
- Updated three pre-existing tests in `convert.test.ts` (`AS-114: HTML with an unresolved class name...`, `AS-114: unresolved class at depth 1...`, `AS-114: an unresolved class on a 3rd-level descendant...`) and one (`AS-119: a node referencing a class with no matching style definition...`) that encoded the old (now-incorrect per this fix) "returns null payload" behavior. These were the tests the M3-scrutiny-10 finding is about — updated their assertions to match the corrected, by-construction behavior (non-null payload, no errors, stub style present) rather than deleting them, so the assertion IDs they exercise stay covered.
- Updated one AS-117 test in `emit.test.ts` (`combo class with undefined base emits a warning and is skipped from output`) — the combo-skip behavior in `buildStyles()` (skip the unparented combo entirely rather than emit it with `comb: ""`) is unchanged and still correct, but since the node still carries that class name, the new AS-114 stub pass now (correctly) emits a plain stub for it. Renamed/adjusted the test to assert the stub is present with `styleLess: ""` and `comb: ""`, while still verifying the original combo-skip warnings fire.
- `collectClasses()` is a straightforward recursive walk of the final `WebflowNode[]` tree (post class-array assignment), matching the spec's suggested helper shape.

## Out-of-scope work needed
None identified. This was a scoped, single-function fix plus test corrections.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Updated pre-existing tests that asserted the old (incorrect) rejecting behavior instead of leaving them failing or deleting them, since the spec's intent (AS-114 "true by construction") directly implies those tests' expectations were wrong per M3-scrutiny-10's finding. This keeps assertion coverage intact and the suite green rather than leaving stale, contradictory tests in place.

## Notes for the next worker
- `collectClasses()` in `emit.ts` walks the already-built `WebflowNode[]` tree (not raw HTML), so it naturally respects whatever class-filtering/normalization `walkElement()` already applied (e.g. whitespace splitting, `Boolean` filter for empty class tokens).
- If a future feature needs to distinguish "real user style" vs "auto-generated stub" in the UI, the stub styles are indistinguishable from a class with legitimately empty CSS (both have `styleLess: ""`, `fake: false`) — there is no `fake: true` flag set by this fix, per the spec's explicit stub shape. If that distinction becomes necessary, it would need a new field or a naming convention (out of scope here).
