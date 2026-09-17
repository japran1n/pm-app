# Handoff: F095 — repair combo chains with missing intermediate links (AS-117 blocker fix)

## Status
COMPLETE

## Assertions covered
AS-117: PASS — every combo chain's `comb` reference resolves to an id present in `styles[]`; missing intermediate combos (e.g. `.a{} .a.b.c{}`) are synthesized as empty stub styles instead of being dropped, and stale `idByKey` entries for skipped combos are removed so deeper combos can never resolve to a dangling id.

## Files changed
lib/webflow-converter/emit.ts
lib/webflow-converter/emit.test.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 393 tests passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Removed the old two-pass `idByKey` pre-registration (which assigned an id to every chain key up front, including combos that later got skipped) and replaced it with lazy id assignment: an id is only written into `idByKey` when a style — real or synthesized stub — is actually pushed onto `styles[]`. This eliminates B1 (stale dangling `comb`) as a structural class of bug rather than patching it with an extra delete call in every skip path.
- For B2 (missing intermediate), synthesis is attempted only one level deep: if a combo's immediate base key is missing, check whether the base's own base ("grandparent") already has a real or synthesized style. If so, synthesize an empty stub (`styleLess: ""`, `variants: {}`, name = last segment of the missing key, `comb` = grandparent's id) and continue processing the current combo normally. If the grandparent is also missing, fall back to the original warn-and-skip behavior — this matches the spec's explicit requirement that a "truly broken" 3+-level chain (none of the intermediates exist) still gracefully skips with a warning instead of attempting unbounded synthesis.
- Updated the pre-existing test `"AS-117: combo class with undefined base emits a warning..."` (using `.a{} .a.b.c{}`) because that exact input is B2's own worked example in the spec — the correct new behavior is synthesis, not skip-and-warn. Renamed/rewrote it to assert the synthesized stub and full chain instead.
- Synthesized stub styles reuse the same `name` collision pattern already present in the codebase (e.g. a standalone `.b` stub from the AS-114 pass and a combo-child stub both named `"b"` but distinguished by `comb !== ""`) — no new naming scheme introduced.

## Out-of-scope work needed
None identified. B1 and B2 are the only two blockers named in the spec and both are fixed with test coverage for 2-level, 3-level (working), 4-level, and "truly broken" 3-level chains.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to eliminate the pre-pass entirely (Option A — defer id assignment) rather than the more surgical "Option B — delete key on skip" suggested as the primary approach in the spec, because deferring assignment removes the B1 bug class structurally (no id ever exists for a style that wasn't pushed) and is no more invasive than adding delete calls at every skip site. The spec explicitly allowed either approach ("You need to either... (A) ... OR (B) ...").

## Notes for the next worker
- `buildStyles()` in `lib/webflow-converter/emit.ts` is the single source of truth for combo-chain resolution; any future combo-related bug should start there.
- Test helper pattern for verifying "no dangling comb references" used throughout the new tests: build `ids = new Set(styles.map(s => s._id))`, then assert every non-empty `s.comb` is in `ids`. Reuse this pattern for any future combo-chain regression tests.
- No MCP tools used — this is pure application-logic code with no external service dependency.
