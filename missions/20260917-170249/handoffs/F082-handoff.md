# Handoff: F082 — remove allowEmptyNodes and fakeStyles escape hatches (AS-112, AS-114)

## Status
COMPLETE

## Assertions covered
AS-112: PASS — `convert("", "")` and `convert("<!-- comment -->", "")` now return `payload: null` with an error containing "must not be empty"; `convert("<div></div>", "")` (1 node, no class) still passes.
AS-114: PASS — `convert('<div class="ghost"></div>', '')` and the depth-1 equivalent now return `payload: null` with an error naming the unresolved class "ghost"; behavior is consistent regardless of nesting depth.

## Files changed
lib/webflow-converter/validator.ts
lib/webflow-converter/convert.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 9 test files, 351 tests passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Removed `opts?: { allowEmptyNodes?: boolean }` entirely from `validatePayload`'s signature (not just its usage) per spec instruction "remove the parameter, the `opts` argument, and the conditional skip."
- Removed the whole `fakeStyles` construction block from `convert.ts`, including the now-unused `realStyleNames`/`usedClassNames` locals; `validatePayload` now runs directly against `emitResult.payload.payload` (with `type` added) instead of an augmented copy.
- Replaced the old "empty HTML string returns an empty valid payload" test (asserted the inverse of AS-112) with a test asserting the null-payload/error contract, and added the four other tests named in the spec (comment-only HTML, ghost class at depth 0 and depth 1, class-free `<div></div>` still valid).
- Changed the pre-existing "converts HTML only (no CSS) into a valid payload" test's fixture from `<div class="wrapper">` to a class-free `<div>` — with fakeStyles removed, a class with no CSS backing now correctly fails AS-114, so the test needed a class-free fixture to keep testing what it originally intended (no-CSS-argument case still converts).

## Out-of-scope work needed
None identified for this feature. Noted but untouched: `lib/webflow-converter/emit.ts` has an unrelated, already-modified-but-uncommitted change in the working tree (per-breakpoint pseudo-state folding) that predates this session and is not part of F082's scope — left as-is, not committed by this worker.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For the pre-existing "converts HTML only (no CSS)" test whose fixture used a class name with no CSS, changed the fixture to be class-free rather than deleting the test outright, since the spec's intent (HTML with no `css` argument still converts) is still valid and worth covering — it just can't carry an unresolved class anymore under the corrected AS-114 enforcement.

## Notes for the next worker
No MCP tools used — this is a pure library/unit-test fix with no external service touched. The full mission test suite beyond `lib/webflow-converter/` was not run (out of scope per the feature spec's explicit `Run:` commands); only `tsc --noEmit` and `npm run lint` were run repo-wide as instructed and both passed clean.
