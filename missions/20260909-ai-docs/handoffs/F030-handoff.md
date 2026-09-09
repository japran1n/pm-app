# Handoff: F030 — Harden the AS-001 guard

## Status
COMPLETE

## Assertions covered
AS-001: PASS — `IMPORT_SPECIFIER_RE` (regex over raw text, blind to newlines) replaced with a real
TypeScript AST walk (`ts.createSourceFile` + `ts.forEachChild`) in `extractSpecifiers`. Verified by
running the existing guard test (still passes — repo remains clean) plus four new self-tests: a
planted 3-hop fixture chain whose middle edge is a multi-line import (guard now detects and reports
the full chain), a unit check that `extractSpecifiers` resolves a multi-line named import, a check
covering `import()`, `export * as ns from`, and `export { } from` split across lines, and a
regression test proving the walk now actually opens `lib/portal/preview-cookies.ts` via the
multi-line import in `lib/supabase/server.ts` (the specific live edge that was previously invisible).
AS-003: PASS — no behavioural change to the forbidden-pattern set or entry roots; guard scope and
semantics preserved, only the specifier-extraction mechanism changed. Full guard test still asserts
zero violations across the real `lib/ai/**` / `app/api/ai/**` tree, now with a walk that actually
sees the codebase's dominant (multi-line) import style instead of silently skipping it.

## Files changed
lib/ai/__tests__/no-service-role.test.ts
tests/integration/support/live-db.ts
missions/20260909-ai-docs/handoffs/F023-handoff.md

## Commands run
`npx tsc --noEmit` (1, but output identical to the 4 documented pre-existing errors — none in
files touched by this feature: `app/layout.tsx`, `components/ui/status-badge.tsx`,
`tests/unit/docs-markdown-editor-export-import.test.tsx` x2)
`npx eslint .` (1, but 26 warnings total vs 27 documented pre-existing — net DECREASE by one; I
initially added an `eslint-disable-next-line no-console` comment for the new `console.error` in
`sweepLeakedFixtures`, which itself triggered an "unused eslint-disable directive" warning because
`no-console` isn't actually configured as a rule here; removed the directive and the console.error
line itself produces zero warnings, so the count went from 27 to 26)
`npx vitest run lib/ai/__tests__/no-service-role.test.ts` (0) — 6 passed
`npx vitest run lib/` (0) — 9 files, 80 tests passed
Did NOT run `npm test` (standing rule — burns the user's live Supabase Auth rate limit; recorded in
`missions/20260909-ai-docs/state.md`).

## Decisions made
- Chose a real AST parse (`ts.createSourceFile` + manual visitor over `ImportDeclaration`,
  `ExportDeclaration`, `ImportEqualsDeclaration` with `ExternalModuleReference`, and
  `CallExpression` nodes for `import(...)`/`require(...)`) over `ts.preProcessFile`. Verified by
  direct experiment: `ts.preProcessFile` misses `export * as ns from "x"` entirely (confirmed with
  a throwaway Node script before committing to the approach) even though it handles the other
  multi-line forms fine. A full AST walk correctly captures every form the spec called out:
  multi-line named/type imports, dynamic `import()` (including `await import(...)`), `export * as
  ns from`, `export { a, b } from`, `export * from`, and `require()` — all regardless of how the
  statement is wrapped across lines, because the parser (not a regex) owns line-boundary handling.
- Kept `resolveSpecifier`'s hardcoded `@/` → `REPO_ROOT + specifier.slice(2)` resolution unchanged.
  It is functionally correct (matches `vitest.config.ts`'s alias target today) and out of this
  feature's stated scope (the defect is specifier *extraction*, not resolution); F030's spec only
  asked to correct the F023 handoff's inaccurate claim about *how* that resolution works, not to
  change the resolution itself.
- Self-test fixture uses a real 4-file chain (entry → hop-a → hop-b → leaf) to match "3-hop chain"
  literally (3 edges), with the *middle* edge (hop-a → hop-b) written as the multi-line import —
  this is the shape the spec explicitly asked for and mirrors the original B1 chain's file count.
  Fixture files are written to `lib/ai/__tests__/tmp-f030-fixture/` and removed via `finally` inside
  a single test, so nothing survives the test run; also fixture files are never on disk during any
  other test's file-system walk since plant/teardown are synchronous around the one assertion.
  Verified this via `try/finally` in `vitest.config.ts`'s default (non-live) run — no other test in
  the suite reads `lib/ai/__tests__/` as an entry root during the same process, but even if it did,
  the fixture only exists mid-assertion inside its own `it()` block.
- For `sweepLeakedFixtures`: check the error from each of the three per-workspace deletes (`docs`,
  `workspace_members`, `workspaces`) and each `auth.admin.deleteUser` call individually, and collect
  every failing id into a new `unswept: { kind, id, reason }[]` return field, plus a `console.error`
  summary when non-empty. Did NOT add retry logic (spec explicitly said not to) and did NOT widen
  the delete scope/prefixes (also explicitly excluded) — this is purely visibility. The `unswept`
  field is additive to the return type (`deletedWorkspaces`/`deletedUsers` keys unchanged), so none
  of the three existing call sites (`list-doc-templates-isolation.test.ts`,
  `get-current-doc-isolation.test.ts`, `search-docs-isolation.test.ts`), which all call
  `sweepLeakedFixtures(...)` without destructuring the return value, needed any change.
- Appended a correction to `F023-handoff.md` rather than editing the original claim, per the
  mission's "credentials never go in markdown... state lives in files" convention and this
  feature's explicit instruction to append rather than rewrite.

## Out-of-scope work needed
- The AS-001 guard's forbidden-pattern check is still a raw substring/regex test on file *source
  text* (not parsed), which is a deliberate over-approximation documented in the test file's header
  comment (catches re-export indirection, can't miss a real reference) — untouched by this feature
  since it wasn't part of the defect described in F030's spec (the defect was specifier extraction,
  not pattern matching).
- `resolveSpecifier` still doesn't handle non-`@/`/non-relative resolution nuances (e.g. `exports`
  map / conditional exports in `package.json` for scoped repo packages, if any exist) — not
  encountered in practice since the guard's only entry roots are `lib/ai/**` and `app/api/ai/**`
  and it correctly treats bare package specifiers as unreachable-by-definition (no repo-local admin
  client can hide inside `node_modules`). Not in scope for F030.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a full TypeScript AST parse rather than a "multiline-tolerant regex" (the
spec's fallback option), because parsing is unambiguously correct for every form listed (including
`export * as ns from`, which even `ts.preProcessFile` — the compiler's own lightweight helper —
does not extract) and the spec said "Prefer parsing... TypeScript is already a dependency." No
regex justification needed since the preferred path was taken and worked cleanly.

## Notes for the next worker
- No MCP tools used — this feature touches only local static-analysis test code and a local-only
  fixture-sweep helper for live-DB integration tests; no live external service state was inspected
  or changed.
- If you need to see exactly which import forms the new `extractSpecifiers` handles, the four new
  tests in `lib/ai/__tests__/no-service-role.test.ts` (search for `describe("AS-001 guard
  falsifiability self-test`) are the executable spec — they're also good regression coverage if a
  future refactor ever swaps the AST walk back out for something faster.
- `sweepLeakedFixtures`'s new `unswept` array is currently only surfaced via `console.error` inside
  the helper itself; it is NOT yet asserted on by any of the three isolation test suites that call
  it (that would be a natural following feature: have those suites fail loudly, not just log, when
  `unswept.length > 0` after their own `afterAll`/`afterEach` sweep — flagged here as an idea, not a
  blocker, since F030 explicitly scoped this to "visible in test output" via logging).
