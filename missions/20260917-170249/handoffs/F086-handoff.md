# Handoff: F086 — fix AS-041 remaining states, breakpoint fold, case-insensitive attributes

## Status
COMPLETE

## Assertions covered
AS-041: PASS — replaced 5 "no slot" tests with correct-slot assertions for :focus-visible/::before/::after, and added breakpoint+pseudo-state fold tests (no leak into unconditional slot, multi-@media merge, base+hover-in-media combo).
AS-091: PASS — added 5 uppercase-attribute tests (ID, CLASS, STYLE, HREF, DATA-FOO) proving case-insensitive attribute handling.

## Files changed
lib/webflow-converter/emit.ts
lib/webflow-converter/emit.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0, 374 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Fix order followed the spec exactly: B-3 (case-insensitive attrs) first, then B-2 (breakpoint fold rewrite), then B-1 (pseudo-state additions), since B-3 makes the other two testable reliably.
- Built the lowercased `attrs` map inside `walkElement` from `el.attributes` and used it for every subsequent lookup (`attrs.id`, `attrs.class`, `attrs.style`, `attrs.type`, `attrs.href` via `getWebflowType`, and the `data-` prefix filter in `buildXattr`). `RESERVED_ATTRS` was already lowercase, so no change needed there.
- Rewrote the breakpoint/state fold in `buildStyles` to accumulate `Record<string, Record<string,string>>` per slot (`variantDecls`) instead of building `WebflowStyleVariants` directly with string concatenation, then stringify once at the end via `toStyleLess`. This fixes both: (a) two `@media` rules for the same breakpoint no longer clobber each other (they merge via object spread), and (b) a composite `<breakpoint>_<state>` key (e.g. "medium_hover") is now warned-and-dropped instead of being folded into the unconditional breakpoint slot, since hover-only declarations must never apply unconditionally.
- Extended `PSEUDO_STATE_TO_WEBFLOW` with `"focus-visible": "focused"` (merged with :focus per spec), `before: "before"`, `after: "after"`. Kept the existing non-underscore-prefixed key convention already used in this file (the file computes bare state names like `"hover"`, `"focus"` via `variantKey.slice(underscoreIdx + 1)`, not `"_hover"`-style keys as in the spec's illustrative snippet — matched the existing code's actual convention instead of the spec's snippet verbatim, since they describe the same behavior).
- `:visited` and `::placeholder` remain unmapped (no Webflow slot) — the existing "does not map to a Webflow state" warning path already covers them; kept those two tests as-is per spec ("tests for those remain as warning assertions").
- Deleted the 5 old tests at the original `emit.test.ts:220-251` that asserted `:focus-visible`, `:visited`, `::placeholder`, `::before`, `::after` all produced zero variants — 3 of those (focus-visible, before, after) asserted the inverse of AS-041 and were replaced with correct-slot assertions; the 2 that genuinely have no slot (visited, placeholder) were kept.
- Added 3 new tests for the B-2 breakpoint-fold rewrite beyond the minimum ("both @media rules for same breakpoint merge, no duplicate/clobber"; "hover inside @media does not leak into medium.styleLess"; "base + hover-in-media leaves medium.styleLess with only base declarations") to match the three bullet points in the spec's Fix B-2 "Tests" section.
- Also updated the warning message text for the breakpoint+pseudo-state case to "per-breakpoint pseudo-state is not representable in Webflow's class editor — declarations skipped" per the spec's illustrative code comment, replacing the old "declarations moved to breakpoint styles" wording (since we no longer move them).

## Out-of-scope work needed
None identified — all three fixes were self-contained within emit.ts/emit.test.ts and no downstream consumer (convert.ts, validator.ts) references the changed internals directly (verified via grep for `PSEUDO_STATE_TO_WEBFLOW`, `variants.before/after`, etc.).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used bare (non-underscore-prefixed) keys in `PSEUDO_STATE_TO_WEBFLOW` ("focus-visible", "before", "after") rather than the spec snippet's "_focus-visible" / "_before" / "_after" style, because the existing code in this file already strips the underscore prefix via `variantKey.slice(underscoreIdx + 1)` before doing the lookup — the snippet in the spec was illustrative pseudocode, not meant to be copied verbatim against a codebase with a different (but equivalent) existing convention.

## Notes for the next worker
- Full test suite run (`npx vitest run lib/webflow-converter/`) covers 9 test files, 374 tests, all passing — confirms `convert.ts` and `validator.ts` still integrate correctly with the rewritten `buildStyles`.
- No MCP tools used — this is a pure local TS module fix with no external service dependency.
