# Handoff: F045 — M8 scrutiny blocker fixes (AS-077, AS-075) attempt 3

## Status
COMPLETE

## Assertions covered
AS-077: PASS — added source-text check that `peopleParam` is never assigned a string literal, plus a check that it originates from `searchParams` destructuring; verified via mutation (swapping the real destructure for `const peopleParam = "all"`) causes the new `not.toMatch` assertion to fail as expected, then reverted.
AS-075: PASS — the gate test now actually spawns `npx vitest run <calendar files> --reporter=verbose` via `execSync` and asserts it does not throw; verified via mutation (inserting a broken/failing line into `f039-stacked-mobile.test.tsx`) causes the execSync call to throw (subprocess exit non-zero) and the test fails as expected, then reverted.

## Files changed
tests/unit/f040-e2e-assertions.test.tsx
tests/unit/f041-final-gate.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f040-e2e-assertions.test.tsx tests/unit/f041-final-gate.test.tsx --reporter=verbose` (0, 10/10 tests passed)
Mutation check 1 (AS-077): replaced `const { week: weekParam, people: peopleParam } = await searchParams;` with `const { week: weekParam } = await searchParams; const peopleParam = "all";` in page.tsx, ran the single AS-077 test — FAILED as expected on the new `not.toMatch(/\bpeopleParam\s*=\s*["'\`][^{]/)` assertion, then reverted file from backup.
Mutation check 2 (AS-075): inserted `expect(1).toBe(2);` into `tests/unit/f039-stacked-mobile.test.tsx`, ran the AS-075 test — the spawned vitest subprocess failed (syntax/assertion break) causing execSync to throw, and `test_AS_075_calendar_unit_tests_pass` FAILED as expected, then reverted file from backup.

## Decisions made
- For AS-077, used `[^{]` after the literal-quote match in the "no string-literal assignment" regex so that destructuring patterns like `people: peopleParam` (which have `{` before `peopleParam`, not `=`) are unaffected, while still catching `peopleParam = "all"` / `peopleParam = 'me'` style mutations. The positive-origin regex separately requires the value to come from `searchParams` in one of three shapes.
- For AS-075, kept the original list of calendar test files (existence-filtered) but now actually executes them under vitest as a subprocess with a 120s execSync timeout and a 150s outer test timeout to avoid the harness's default test timeout killing a legitimately slow subprocess run.
- Did not touch AS-076 or AS-084 tests in f041 — they were unaffected by the scrutiny findings and already run real subprocess checks (migrations:check, git diff).
- Only staged/committed the two test files I edited; left pre-existing unrelated working-tree changes (missions/20260920-124226/handoffs/F042-handoff.md, next-env.d.ts, playwright-mcp artifacts) untouched since they predate this task and are out of scope.

## Out-of-scope work needed
None identified for this task.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to leave pre-existing unstaged/untracked changes in the working tree unmodified and uncommitted, since they were not part of this feature's scope and committing them could conflate unrelated work into this commit.

## Notes for the next worker
- The AS-075 test now takes ~3.2s (spawns a real vitest subprocess covering 11 calendar test files); this is intentional per the mission's spec for this fix and is bounded by a 150_000ms test timeout.
- If a future scrutiny pass tries the same "narrow existence-only check" attack pattern on AS-075, note that the current implementation already executes the files for real via `execSync`, so a stub-only regression would need to defeat the subprocess exit-code check, not just file existence.
- Mutation backups used during verification were made via `cp` to `/tmp` inside the scratchpad flow and were fully reverted before committing; git status confirms only the two intended files changed by this commit.
