# Handoff: F058 — Per-declaration error containment

## Status
COMPLETE

## Assertions covered
AS-057: PASS — `expandBorderRadius` now guards empty and leading-slash `border-radius` values, returning `{decls:{}, warning}` instead of throwing on destructuring; verified with `npx vitest run lib/webflow-converter/`.
AS-029: PASS — `parseCss` wraps `postcss.parse` in try/catch and returns `{classes: new Map(), order: [], warnings: [CSS parse error...]}` for a `CssSyntaxError` instead of throwing; the inner declaration loop also wraps `expandDeclaration` in try/catch and pushes an `unexpected error expanding '<prop>'` warning on any unexpected throw, so a single bad declaration never aborts parsing the rest of the stylesheet. Verified with `npx vitest run lib/webflow-converter/`.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/css.ts
lib/webflow-converter/css.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 187 passed (187), 4 test files
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- `expandBorderRadius` now returns an `ExpandResult` ({decls, warning?}) instead of a bare `Record<string,string>`, since it needs to short-circuit with a warning-only result for the empty/leading-slash guard cases. The `border-radius` case in `expandDeclaration` was updated to consume the new shape and still preserve the existing "elliptical radii flattened" warning behavior for the non-guarded, multi-part case.
- Kept the guard order exactly as specified: empty/whitespace check first, then leading-slash check, then the existing `splitTop(value, /\//)` destructuring — so neither guard can be bypassed by malformed input reaching the destructuring first.
- For the `CssSyntaxError` catch in `parseCss`, used a duck-typed check (`'name' in e && e.name === 'CssSyntaxError'`) rather than importing postcss's error class, matching how postcss surfaces this error and avoiding a hard dependency on postcss's internal export surface.
- Any other unexpected error class from `postcss.parse` is re-thrown (not swallowed), since only `CssSyntaxError` is a documented "expected bad input" case per the postcss docs.

## Out-of-scope work needed
None identified — this feature is a narrow error-containment hardening pass on two already-shipped modules (F012/F014 selector+shorthand expansion) and required no changes outside `lib/webflow-converter/`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to change `expandBorderRadius`'s return type to `ExpandResult` (rather than layering the guard checks at the `expandDeclaration` call site) so the guard logic lives with the function that owns the `/`-split parsing it protects, keeping the fix colocated with the code it guards, per the clarified spec's explicit instruction to add the checks "at the start of expandBorderRadius."

## Notes for the next worker
- No MCP tools were used — this feature is pure application/test code in `lib/webflow-converter/`, no live external service state involved (per `worker-mcp-usage` skill decision tree: "Pure UI feature/pure logic" → no MCP).
- Note for the record: my edits landed in git commit `55947b68` ("fix(AS-057): warn on nested and unknown at-rules instead of silent loss"), which already existed in the working tree history when I went to commit — the repository's commit-time state shows my staged `css.ts`/`css.test.ts`/`longhand.ts` changes already committed under that prior commit message by the time I ran `git commit`, so no new commit was created by this worker run (nothing left to commit, working tree clean for the touched files). This looks like a race with a concurrent process in the repo; the code changes themselves are exactly as specified in the task and fully present at `HEAD`. All three fixes (border-radius guards, per-declaration try/catch, CssSyntaxError catch) and the three new tests are live in the committed `HEAD`.
