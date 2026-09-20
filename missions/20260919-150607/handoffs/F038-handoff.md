# Handoff: F038 — Action barrel guard (dead-action detection)

## Status
COMPLETE

## Assertions covered
AS-130: PASS — test exists and asserts every exported architecture action has at least one reference outside the barrel/leaf modules/tests

## Files changed
tests/unit/m6-action-barrel-guard.test.ts

## Commands run
`npx vitest run tests/unit/m6-action-barrel-guard.test.ts` (0, 2 passed)

## Decisions made
- Parsed the barrel via regex matching `export { ... } from "...";` blocks, explicitly skipping blocks preceded by `type` (i.e. `export type { ... } from ...`) so only value/function exports are checked, not re-exported types.
- Used word-boundary regex search per action name across all non-excluded .ts/.tsx files, which is sufficient for import/call-site detection without needing a full TS AST parser (per spec's "read FS + grep" pattern, no new dependencies).
- Excluded common build/dep directories (node_modules, .next, .git, dist, build) in addition to the barrel file itself, `lib/actions/architecture/` leaf modules, and `*.test.ts(x)`/`*.spec.ts(x)` files, per spec.
- Added a sanity test asserting parsing yields at least one action name, to catch silent regressions in the parser itself.

## Out-of-scope work needed
None identified.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used regex-based parsing instead of a TypeScript AST library since the spec explicitly says "No new dependencies" and the barrel file's export style is simple and consistent (`export { a, b } from "./x"`).

## Notes for the next worker
Test currently passes on HEAD: all 18 actions exported from lib/actions/architecture.ts have at least one call site outside the barrel/leaf/test files. If a future refactor removes a call site for an action, this test will fail by name, satisfying the "definition of done" regression check.
