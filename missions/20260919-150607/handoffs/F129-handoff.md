# Handoff: F129 — Fix AS-180/AS-181 positive column + tree scan

## Status
COMPLETE

## Assertions covered
AS-180: PASS — test now positively asserts TASK_COLUMNS contains `page_kind` and `page_slug`, and negatively asserts COMPONENT_COLUMNS does not contain `description`; old unmatchable regex removed.
AS-181: PASS — test now greps app/, components/, lib/ (*.ts, *.tsx) for `setNodeMetaClientVisibility`, filters out test/spec/missions/handoffs/__tests__ paths, and asserts the remaining match list is empty, in addition to the existing barrel-file check.

## Files changed
tests/unit/m9-regression.test.ts

## Commands run
`npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` (0)
`npx tsc --noEmit` (0)

## Decisions made
- Read lib/queries/architecture.ts to find the actual column constants: `TASK_COLUMNS` (contains `page_kind`, `page_slug`, etc.) and `COMPONENT_COLUMNS = "id, name, position"` (description already dropped). Extracted these via regex capture on the source text rather than re-declaring the constants, so the test stays coupled to the real implementation.
- For AS-181, used `execSync` with `grep -r ... || true` per the spec instructions to avoid non-zero exit when no matches are found, then filtered out test/spec/mission/handoff paths in JS rather than in the grep command for clarity and easier maintenance.
- Kept the existing node_meta absence check and barrel check in place since they were already correct sub-assertions.

## Out-of-scope work needed
None identified. Note: during this session another test in the same file (AS-178) was concurrently rewritten by a different process/worker to a hash-based check — untouched by me, not part of this feature's scope (AS-180/AS-181 only).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
None beyond what the spec explicitly directed.

## Notes for the next worker
- lib/queries/architecture.ts constants: `TASK_COLUMNS` (line ~75) and `COMPONENT_COLUMNS` (line ~91, comment notes "F032: description dropped from page_components").
- The AS-180 test now parses these constants via regex; if the constant names or declaration style change, update the regex patterns (`const TASK_COLUMNS\s*=\s*\n?\s*"([^"]+)"` and `const COMPONENT_COLUMNS\s*=\s*"([^"]+)"`) accordingly.
- No MCP tools used — this was a pure test-file fix with no live external service state involved.
