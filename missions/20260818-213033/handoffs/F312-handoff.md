# Handoff: F312 — Stabilize integration test infra (hook-timeout silent-skip fix)

## Status
COMPLETE

## Assertions covered
AS-358: PASS — evidence file(s) run together (with the other 8 files below) with no hook-timeout/skip; see tests covering AS-358.
AS-359: PASS — evidence file(s) run together, no hook-timeout/skip.
AS-360: PASS — `tests/integration/recurrence-scheduled-generation-activity.test.ts`; passes alone and in the full-suite run this session did not exhibit a hook-timeout skip (it hit an unrelated, pre-existing Postgres `statement_timeout` (57014) under heavy concurrent full-suite load in one run, confirmed not a regression by re-running the file alone — 2/2 passed).
AS-374: PASS — evidence file(s) run together, no hook-timeout/skip.
AS-375: PASS — evidence file(s) run together, no hook-timeout/skip.
AS-380: PASS — evidence file(s) run together, no hook-timeout/skip.
AS-381: PASS — evidence file(s) run together, no hook-timeout/skip.
AS-382: PASS — evidence file(s) run together, no hook-timeout/skip.
AS-384: PASS — evidence file(s) run together, no hook-timeout/skip.

(All 9 assertion IDs are covered across `tests/integration/f306-mutation-fanout.test.ts`,
`tests/integration/notification-fanout.test.ts`,
`tests/integration/recurrence-scheduled-generation-activity.test.ts`,
`tests/integration/rls-activity.test.ts`,
`tests/integration/task-activity-feed.test.ts`,
`tests/integration/task-activity-writer.test.ts`,
`tests/unit/description-mentions.test.ts`,
`tests/unit/format-task-activity-entry.test.ts`,
`tests/unit/notification-fanout.test.ts`. Ran all 9 together: 75/75 tests passed, 0 hook timeouts, 0 silently-skipped files. This feature is infra-only — it does not touch product code for these assertions; its job was to make sure a canonical `npm run test` run can no longer silently skip the file that carries each of these assertions' primary evidence.)

## Files changed
vitest.config.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings)
`npx vitest run <18-file integration slice>` — BEFORE fix: 1 file hook-timeout ("Hook timed out in 10000ms" in `afterAll`, `tests/integration/change-workspace-slug.test.ts`), 17 passed / 1 failed(skipped-tests-reported-as-failed-suite) (0)
`npx vitest run <same 18-file slice>` — AFTER fix (hookTimeout: 30_000, maxWorkers: 4): 18 files passed, 117/117 tests passed, no hook timeouts (0)
`npx vitest run <35-file integration slice>` — AFTER fix: 33 passed / 2 failed on `Request rate limit reached` (Supabase Auth sign-in, pre-existing accepted flakiness class, not hook-timeout/skip); re-ran the 2 failing files alone — both passed cleanly, confirming no regression (0/1 mixed — see notes)
`npm run test` (full suite, backgrounded) — 244 passed / 7 failed test files, 1688/1705 tests passed; zero occurrences of "Hook timed out" in the entire log (grep confirmed); the 7 failures are pre-existing Supabase rate-limit / Postgres statement-timeout flakiness and 2 unrelated pre-existing unit-test failures (`tests/unit/trash-list.test.tsx`, `tests/unit/user-avatar.test.tsx` — a Next.js `cookies()`-outside-request-scope error, unrelated to this change) (0 — non-zero test exit code from flaky tests, but no hook-timeout/skip pattern, which is what this feature targets)
`npx vitest run tests/integration/recurrence-scheduled-generation-activity.test.ts` (re-run alone after full-suite flake) — 2/2 passed (0)
`npx vitest run` on the 9 files carrying this feature's 9 assigned assertion IDs, together — 75/75 tests passed (0)

## Decisions made
- Root cause confirmed empirically: vitest's `hookTimeout` defaults to 10_000ms independently of `testTimeout` (which F278 had already raised to 30_000ms for test bodies only). Under load, `beforeAll`/`afterAll` hooks that create/clean up Supabase test users exceed 10s and vitest reports this as the whole file's tests being **skipped**, not failed — this is the actual observability bug (a canonical `npm run test` run could silently never execute a file's assertions).
- Applied the smallest fix consistent with F278's existing pattern and this repo's single `"test": "vitest run"` script (no separate unit/integration script split exists in package.json, so scoping the config to "integration only" via a second config file was rejected as unnecessary complexity — the whole suite already shares one script and one config).
  - `hookTimeout: 30_000` — matches `testTimeout` exactly, so hooks get the same headroom already proven deterministic for test bodies by F278.
  - `maxWorkers: 4` (top-level; the old `poolOptions.forks.maxForks` nesting is deprecated in the installed Vitest 4.1.10 — confirmed via `node_modules/vitest/dist/chunks/config.d.A1h_Y6Jt.d.ts` which only exposes `maxWorkers` at the top level now) — caps concurrent Supabase Auth-heavy forks so files aren't all contending for the same rate limit/connection pool at once, trading some wall-clock time for suite reliability.
- Did NOT pursue option 3 (shared/pooled test-user refactor across ~40 files) — options 1+2 fully eliminated the hook-timeout/skip pattern in every repro I ran (18-file slice, 35-file slice, and the full 251-file suite), so the larger refactor is out of scope per the spec's explicit preference for the smaller fix.
- Did not touch `tests/e2e/**` or `extension/**` (already excluded in `exclude`), consistent with "Touches: vitest.config.ts only."

## Out-of-scope work needed
- `tests/unit/trash-list.test.tsx` and `tests/unit/user-avatar.test.tsx` both failed in the full-suite run with pre-existing, unrelated issues (a `cookies()` called outside request scope error inside `CommentList`/`getMentionCandidates`, and apparent snapshot/assertion drift in trash-list). These are not part of F312's scope (they're not integration-tier Supabase contention issues) and were not investigated further; a follow-up feature should look at these two unit test files if they're still failing on a clean, non-contended run.
- The accepted Supabase Auth rate-limit / Postgres statement-timeout flakiness class remains present under heavy concurrent load (confirmed again this session in the 35-file slice and the full-suite run) — this is explicitly out of scope per the spec ("this feature's job is specifically the hook-timeout-causes-silent-skip problem, not to solve every flakiness class"). The existing "re-run the file alone to confirm" mitigation still applies and was used successfully here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `hookTimeout: 30_000` + `maxWorkers: 4` (options 1+2 combined) over a full test-user-pooling refactor (option 3), because empirical testing (18-file slice, 35-file slice, full 251-file suite) showed options 1+2 alone fully eliminate the hook-timeout/skip pattern — the spec explicitly asked to prefer the smaller-scope fix unless 1/2 didn't work, and they did.
AUTONOMOUS_DECISION: Used top-level `maxWorkers` instead of the `poolOptions.forks.maxForks` the spec's option 2 suggested by name, because this repo's installed Vitest is v4.1.10, which deprecated/removed the nested `poolOptions` shape in favor of top-level pool options (confirmed by both a runtime deprecation warning and the installed type declarations) — `maxWorkers` is the current equivalent for capping concurrent forks.

## Notes for the next worker
- Vitest CLI multi-file filtering gotcha hit during this work: `npx vitest run $unquoted_var_with_newlines` intermittently produced "No test files found" even though the same file list worked fine when built into a zsh array (`files=(); while IFS= read -r line; do files+=("$line"); done < list.txt; npx vitest run "${files[@]}"`). If reproducing a slice run again, prefer the array-based invocation over a raw `$(cat file)` substitution.
- To reproduce the "before" state for verification, you'd need to temporarily revert `hookTimeout`/`maxWorkers` in `vitest.config.ts` — the repro used in this handoff (an 18-file slice starting alphabetically from `tests/integration/`) reliably hit the 10s default hook timeout on `change-workspace-slug.test.ts`'s `afterAll` before the fix.
- No MCP tools were used for this feature — it is pure vitest config, no live Supabase schema/policy state was touched.
