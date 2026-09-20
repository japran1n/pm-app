# Handoff: F133 — Fix AS-180/181: COMPONENT_COLUMNS positive + dropped-column grep

## Status
COMPLETE

## Assertions covered
AS-180: PASS — added positive assertions `expect(componentColumns).toContain("name")` / `.toContain("position")` in the existing AS-180 test block; verified by mutation (see below).
AS-181: PASS — added a second scan in the AS-181 test block that greps app/, components/, lib/ for `client_visible`, then filters to files that also contain `architecture_node_meta`, and asserts the filtered list is empty; verified by mutation (see below).

## Files changed
tests/unit/m9-regression.test.ts

## Commands run
`npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` (0) — 4/4 tests pass
`npx tsc --noEmit` (0)
Mutation 1: removed `name` from `COMPONENT_COLUMNS` in lib/queries/architecture.ts, ran vitest → AS-180 failed as expected (`Expected: "name" Received: "id, position"`), then reverted (`git status --short lib/queries/architecture.ts` clean after revert).
Mutation 2: added `, client_visible` to the `.select(...)` on `architecture_node_meta` in lib/queries/architecture-details.ts, ran vitest → AS-181 failed as expected (`Files reference dropped column architecture_node_meta.client_visible: lib/queries/architecture-details.ts`), then reverted (clean after revert).
`git commit` (0)

## Decisions made
- No MCP usage needed — this is a pure static-analysis/grep test fix, no live schema or external service state involved.
- Kept the AS-180 extraction regex unchanged since `COMPONENT_COLUMNS` in `lib/queries/architecture.ts` is already a plain double-quoted string literal (`const COMPONENT_COLUMNS = "id, name, position";`), matching the existing `/const COMPONENT_COLUMNS\s*=\s*"([^"]+)"/` regex with no adaptation needed.
- Followed the spec's exact filter list for the new AS-181 scan (excluding `.test.`, `.spec.`, `missions/`, `database.types.ts`) and additionally kept the existing AS-181 scan's `handoffs/` and `__tests__/` exclusions for consistency, since those are legitimate non-production paths that could otherwise false-positive.

## Out-of-scope work needed
None identified within this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was unambiguous and followed exactly as written)

## Notes for the next worker
Note: at commit time, `git status` showed several files already staged from a prior session/worker (components/code-editor/editor-pane.tsx, scripts/check-cron-health.mjs, and a handful of tests/unit/th-*.test.ts/tsx files) that were not part of this feature's scope. Running `git add tests/unit/m9-regression.test.ts` followed by `git commit` picked up those pre-staged files too since they were already in the index before this worker started. I did not author or intentionally include those changes — they predate this session. The orchestrator may want to verify those files' diffs are intentional/expected from whatever prior work staged them.
