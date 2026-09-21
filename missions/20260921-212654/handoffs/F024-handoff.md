# Handoff: F024 — restore-full-baseline-scope

## Status
COMPLETE

## Assertions covered
SB-001: PASS — docs-only change; no sidebar code touched, no regression (unit failing set unchanged).
SB-004: PASS — full-suite baseline captured and labelled; run-log declares enforceable scope = tests/unit.

## Files changed
missions/20260921-212654/baseline-failing-files-full.txt
missions/20260921-212654/run-log.md
missions/20260921-212654/handoffs/F024-handoff.md

## Commands run
`git worktree add --detach <scratchpad>/wt b16e1ce5` (0), node_modules symlinked, .env* copied
`npx vitest run --exclude '.claude/**' --exclude 'node_modules/**' --reporter=json` in worktree (1, expected: 300 failing files)
`git worktree remove --force` (0)
`npx vitest run tests/integration/add-comment.test.ts` at HEAD (1, fetch failed); `curl 127.0.0.1:54321` (7, refused)
`npx vitest run tests/unit` (not re-run: no code changed; baseline unit list diffed against full run: 46 vs 47, only f041-final-gate differs, flaky)
No MCP used.

## Decisions made
- Baseline commit b16e1ce5 is the pre-mission commit, so the worktree had no .claude/worktrees; I passed --exclude '.claude/**' explicitly to mirror the current config.
- Kept unit-only file, added -full file; declared SB-004 enforceable scope = tests/unit since integration needs Supabase at 127.0.0.1:54321.
- Vitest JSON did not carry ECONNREFUSED text (214 integration suites have empty messages; others "fetch failed"); confirmed refusal via curl exit 7 and stated it that way.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: chose the "integration cannot run, scope = tests/unit" option offered by the spec.

## Notes for the next worker
tsc/eslint unaffected (no code touched). Full run: 300 failed of 891 files.
