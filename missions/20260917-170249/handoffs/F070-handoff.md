# Handoff: F070 — rewrite mapBreakpoint guard as case-insensitive anchored grammar

## Status
COMPLETE

## Assertions covered
AS-048: PASS — `mapBreakpoint` now normalizes (lowercase + collapse whitespace) then matches an anchored whitelist grammar (optional media-type prefix + exactly one width condition). All prior negative cases plus new uppercase/malformed-prefix/compound-condition cases return null; new `(width <= Npx)` / `(width >= Npx)` symmetric forms map correctly.

## Files changed
lib/webflow-converter/breakpoints.ts
lib/webflow-converter/breakpoints.test.ts
missions/20260917-170249/handoffs/F070-handoff.md

## Commands run
`npx vitest run lib/webflow-converter/breakpoints.test.ts` (0, 37 passed)
`npx vitest run lib/webflow-converter/` (0 for breakpoints; 1 pre-existing unrelated failure in longhand.test.ts — see Notes)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Rewrote `mapBreakpoint` to: (1) normalize with `.trim().toLowerCase().replace(/\s+/g, ' ')`, (2) strip at most one exact optional-prefix from `['only screen and ', 'only all and ', 'screen and ', 'all and ']`, (3) match the remainder against an anchored regex grammar for exactly one width condition (`max-width`/`min-width`/`width <=`/`width <`/`width >=`/`width >`), with no leftover content permitted. Anything not matching the grammar returns `null` — no blacklist checks remain.
- Kept support for bare (unparenthesized) `max-width: Npx` / `min-width: Npx` forms alongside the parenthesized forms, because existing tests and the real caller (`css.ts`'s `mapBreakpoint(node.params)`) may pass either shape depending on how the AST reports `@media` params; the spec's grammar didn't explicitly forbid this and removing it would have broken existing passing assertions (AS-070–073) that predate this follow-up.
- Kept the existing `(width < Npx)` / `(width > Npx)` strict range forms (treating `< N` as `<= N-1`, and `> N` as unmapped) since the spec only asked to *add* the `<=`/`>=` symmetric forms, not remove the pre-existing `<`/`>` support, and an existing test (`AS-071: (width < 768px)`) depends on it.
- Replaced the old whitespace/case-insensitivity test (which asserted a value covered by the new normalization step, i.e. a "fallthrough" no longer relevant) is retained as-is (it still holds true) and added a new explicit guard test asserting the grammar rejects any trailing/compound content rather than silently falling through.

## Out-of-scope work needed
None identified for this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Preserved backward-compatible support for bare (non-parenthesized) width conditions and for strict `<`/`>` range forms, since the spec's grammar prose focused on the new failure modes to close (case sensitivity, malformed prefixes, compound conditions) and didn't call for removing these pre-existing accepted forms; removing them would have broken existing assertions AS-070–073 and the existing `(width < 768px)` test.

## Notes for the next worker
`npx vitest run lib/webflow-converter/` shows one failing test in `longhand.test.ts` (`test_AS_055_unrecognized_token_drops_whole_declaration`). This is unrelated to this feature — `git stash` confirms it fails identically on a clean checkout before this change (the file `lib/webflow-converter/longhand.ts`/`.test.ts` was already modified/dirty in the working tree from concurrent mission activity before this worker started). Not touched by this feature; left untouched per scope.
