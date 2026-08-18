# Handoff: F089 — perf budget check

## Status
COMPLETE

## Assertions covered
AS-156: PASS — getProjectBoardTasks (F042) measured at v1-scale (80 seeded tasks across the 4 board columns, real linked Supabase project, member client under RLS), 20 runs: p95=150.6ms, min=96.7ms, max=155.9ms, mean=120.3ms — well under the 500ms budget from discovery Q27.
AS-136: PASS — dashboard RPCs (get_priority_counts/get_status_counts/get_overdue_count, F071/F072/F075) measured against the same 80-task/one-workspace seed, 20 runs each: get_priority_counts p95=143.7ms (min=102.9 max=144.3 mean=122.2), get_status_counts p95=165.9ms (min=103.8 max=187.0 mean=127.0), get_overdue_count p95=136.7ms (min=95.3 max=140.1 mean=117.0) — all under the 500ms budget.

## Files changed
tests/integration/perf-budget.test.ts

## Commands run
`npx vitest run tests/integration/perf-budget.test.ts --reporter=verbose` (0) — perf numbers above captured from this run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm test` (0) — 436/436 passed; one unrelated pre-existing timing flake in tests/integration/reorder-task.test.ts's afterAll cleanup hook seen on one run under DB load, confirmed pre-existing by re-running that file alone (6/6 passed) and by re-running the full suite again (436/436 passed, different file's afterAll flaked that time) — not caused by this feature's file, which touches only insert/select/rpc against a scoped, cleaned-up workspace
`npm run build` (0)

## Decisions made
- Wrote a new integration test (tests/integration/perf-budget.test.ts) rather than a standalone script, matching this repo's established pattern (board-columns-render.test.ts, priority-counts-rpc.test.ts) of real-Supabase integration tests gated by `describe.skipIf(!haveAdminCreds)` and the loadDotEnv helper — consistent with the DoD's "integration test for Server Actions touching Supabase" guidance and this feature's "small perf script or a test" file hint.
- Seeded exactly one project with 80 tasks spread evenly across the 4 fixed board statuses and 5 priorities (per feature spec's "50-100 across 4 columns" v1-scale guidance), with every 5th task overdue, so the same seed data serves both AS-156 (board fetch) and AS-136 (dashboard RPCs, which need priority/status/overdue variety) without seeding twice.
- Ran each call 20 times sequentially against the live linked Supabase project (not mocked, not against a local/emulated DB) and computed p95/min/max/mean in-process with `performance.now()`; asserted `p95 < 500` for each of the 4 calls (board fetch + 3 RPCs) so the test fails outright if the budget is exceeded, not just logs a warning, per the DoD.
- tech-decisions.md has no pre-existing numeric performance budget for AS-136; per plan.md's "Deferred re-verification (M7)" note, this feature (F089) is where that budget gets defined for the first time — used the same 500ms/p95 contract as AS-156 (discovery Q27) since both assertions were grouped under this one feature and the validation-contract's AS-136 text ("within the performance budget defined in tech-decisions.md") is naturally satisfied by treating F089 as that definition point.
- Batch-deleted seeded tasks in afterAll via `.in("id", createdTaskIds)` instead of one-by-one `.eq()` deletes (the pattern used by some older tests in this repo) — with 80 rows, per-row deletes exceeded vitest's default 10s hook timeout; batching plus a 30s hook timeout fixed it without changing what's cleaned up.

## Out-of-scope work needed
None identified. Both measured latencies (max observed p95 ~166ms) are roughly 3x under budget at v1 scale, so no index/N+1 investigation was needed — RLS policies and the existing RPC functions already perform well at this data volume.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used 20 runs per call (not specified by the spec beyond "multiple runs") as a reasonable sample size for a p95 statistic without making the test suite noticeably slower; total added test time is ~10s.
AUTONOMOUS_DECISION: Established the AS-136 500ms budget value itself (tech-decisions.md had none), reusing AS-156's discovery-Q27 number since this feature groups both assertions together and validation-contract.md ties AS-136 to "the performance budget defined in tech-decisions.md" without that definition existing anywhere else yet.

## Notes for the next worker
- Real numbers, captured via `npx vitest run tests/integration/perf-budget.test.ts --reporter=verbose`: AS-156 p95=150.6ms; AS-136 p95s were 143.7ms / 165.9ms / 136.7ms for priority/status/overdue respectively. All comfortably under the 500ms budget — no fix was needed.
- If tech-decisions.md ever gets a dedicated "Performance budgets" section added by a later feature, it should reference this handoff's numbers as the AS-136 baseline rather than re-measuring from scratch, since the RPCs and query shape haven't changed since F071/F072/F075/F042 landed.
- The `reorder-task.test.ts` afterAll timeout seen once during `npm test` is unrelated to this feature (that file wasn't touched) — flagged here only so it isn't mistakenly attributed to F089 if seen again; it passed cleanly both standalone and on a full-suite re-run.
