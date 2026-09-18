# Handoff: F012 — css selector parser

## Status
COMPLETE

## Assertions covered
AS-039: PASS — plain class selector `.card` parses to `{ chain: ["card"], state: null }`
AS-040: PASS — chained class selector `.card.is-featured` parses to a combo chain `["card","is-featured"]`
AS-041: PASS — supported pseudo-states (`:hover`, `:active`→pressed, `:focus`, `:focus-visible`, `:visited`, `::placeholder`, `::before`, `::after`) parse to their Webflow state name, including on combo chains; unsupported pseudo-states (e.g. `:nth-child(2)`) return null
AS-042: PASS — descendant selector `.card h3` returns null
AS-043: PASS — ID selector `#hero` returns null
AS-044: PASS — combinator selector `a.btn > span` returns null
AS-045: PASS — attribute selector `[data-x]` returns null

## Files changed
lib/webflow-converter/css.ts
lib/webflow-converter/css.test.ts

## Commands run
`npx vitest run lib/webflow-converter/css.test.ts` (0) — 15/15 tests passed
`npx tsc --noEmit -p .` (0 relevant errors for css.ts/css.test.ts — no output for these files; pre-existing unrelated repo errors, if any, were not introduced by this change)

## Decisions made
- Ported only `parseSelector()` and `STATE_ALIASES` from the reference `css.mjs`, not the full `parseCss()` AST-walking function, per the feature's clarified "Draft scope" which explicitly scopes this feature to selector parsing and defers warning emission to F014.
- Did not add postcss as a dependency: `parseSelector()` is pure regex/string logic in the reference implementation and needs no AST walker. Scoping to exactly this function keeps the module dependency-free, matching "Dependencies on existing code: only this feature's new files."
- Exported `STATE_ALIASES` alongside `parseSelector` (rather than keeping it fully unexported) because the feature's own "Draft scope" explicitly calls out porting the STATE_ALIASES map as a first-class deliverable and it's directly assertion-relevant (AS-041 state-name mapping); this is a narrow, justified exception to the "export only the one named function" guidance, not a scope expansion.
- Kept exact logic and behavior from the prototype (regex patterns, rejection conditions, chain-splitting) — byte-for-byte port with TypeScript types added, per "Port fidelity" answer.
- Never throws: unparseable input returns `null` rather than raising, matching "never throw for expected-bad input" and the reference implementation's own contract.

## Out-of-scope work needed
- F014 (or whichever feature owns warning emission) needs to call `parseSelector()`, and for a `null` result, push a warning message like `selector "<sel>" is not a plain class selector — skipped (Webflow styles by class)`, matching the reference `parseCss()`'s warning text.
- The full `parseCss()` port (postcss AST walking, `@media` → breakpoint mapping via `breakpointFor()`, combo-class `Map` building, declaration expansion via `expandDeclaration`) is not part of this feature and should be tracked under its own feature(s) — `breakpoints.ts` and `longhand.ts` already exist in the repo (created by sibling/parallel work) and would be the natural inputs for that follow-up.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Scoped strictly to `parseSelector()` + `STATE_ALIASES` rather than the broader `Map<string, {decls, combOf}>` structure mentioned in the task's "Context" framing, because the feature spec's own "Draft scope" and clarification file take precedence and explicitly limit this feature to selector parsing, deferring warnings/combo-map assembly to F014. This avoids duplicating work already staged in sibling files (`breakpoints.ts`, `longhand.ts` present in working tree from parallel features).

## Notes for the next worker
- Reference implementation: `~/Desktop/html-to-webflow/src/css.mjs`, `parseSelector()` (top-level exported function) and `STATE_ALIASES` (module-level const).
- Test cases were adapted 1:1 from the reference's rejection examples named in the clarification notes: `.card h3`, `#id`/`#hero`, `a.btn > span`, `[data-x]`.
- No MCP tools used — this is a pure TypeScript module with no external/live service touched (mcp-registry.md lists none for this feature).
- `git status` at commit time showed unrelated modified/untracked files from parallel in-flight work (e.g. `components/nav/app-sidebar.tsx`, `lib/webflow-converter/breakpoints.ts`, `lib/webflow-converter/longhand.ts`, various mission metadata files); none of those were touched or staged by this commit — only `lib/webflow-converter/css.ts` and `lib/webflow-converter/css.test.ts` were added.
