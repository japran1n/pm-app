# Handoff: F021c — A measurement from before the baseline is shown as an improvement

## Status
COMPLETE

## Assertions covered
AS-041: PASS — `deriveMetricMeasurementStatus` now returns `not_measured` when `latestSnapshot.measuredAt < metric.baselineAt`, verified by a new test that fails when that comparison is removed (demonstrated below, then reverted). All 8 AS-041 tests in `tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts` and all AS-041 tests in `components/portal/metric-comparison-card.test.tsx` pass.

## Files changed
lib/queries/metrics.ts
app/(portal)/portal/[workspaceSlug]/p/[projectId]/results/page.tsx
tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts
components/portal/metric-comparison-card.test.tsx
supabase/migrations/20261015010000_f021c_budget_sweep_atomic_and_leadless.sql

## Commands run
`npx vitest run tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts components/portal/metric-comparison-card.test.tsx tests/integration/f018-budget-threshold-sweep.test.ts` (0, 37 passed)
`npm run db:apply -- supabase/migrations/20261015010000_f021c_budget_sweep_atomic_and_leadless.sql` (0)
`npx vitest run tests/integration/f018-budget-threshold-sweep.test.ts` (0, 3 passed, re-run after migration apply)
`npm run db:gen-types` (0)
`npx tsc --noEmit` (0)
`npx eslint lib/queries/metrics.ts "app/(portal)/portal/[workspaceSlug]/p/[projectId]/results/page.tsx" tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts components/portal/metric-comparison-card.test.tsx` (0)
`npx vitest run tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts -t "AS-041"` — ran twice: once with the `measuredAt`/`baselineAt` comparison temporarily deleted (1 failed as expected, showing "expected 'improved' to be 'not_measured'"), then again after reverting to the fix (all passed). Not left in the repo; this was a demonstrate-then-revert step per the spec.

## Decisions made
- `deriveMetricMeasurementStatus`'s parameter type is now `Pick<ProjectMetric, "baselineValue" | "direction" | "baselineAt">` instead of omitting `baselineAt` — the spec's own root-cause finding was that the old type couldn't even express the comparison. Confirmed by grep that both call sites (`results/page.tsx:137` and `components/project/measurement-panel.tsx:129,739`) already pass a full `ProjectMetric`, so widening the `Pick` required no caller changes; only the test files that hand-built the narrower object needed `baselineAt` added.
- `baselineAt`/`measuredAt` are Postgres `date` columns (confirmed: `supabase/migrations/20261013010000_f020_metrics_snapshots_improvements_baseline_freeze.sql:76,110`, `baseline_at date` / `measured_at date not null`), so they arrive as `YYYY-MM-DD` strings and a plain string comparison (`<`) is a correct chronological comparison without a `Date` parse.
- `metric.baselineAt === null` (with a non-null `baselineValue`, which the DB should never produce since both are written together per the freeze trigger at `20261013010000:155-171`) is treated as `not_measured` rather than assuming any snapshot qualifies — the honest default when there is no baseline date to compare against.
- F018 sweep fix: moved the `update notifications set project_id = ...` statement inside the existing `begin ... exception when others` block. Verified by reading the original migration line-by-line (`supabase/migrations/20261012010000_f018_budget_threshold_sweep.sql:170-210`) that `create_notification`'s own `INSERT` never sets `project_id` (its signature has no such parameter, confirmed by the migration's own comment at lines 204-209), so the partial unique index `notifications_budget_threshold_once_idx` (project_id, user_id, kind, period_start) can only ever raise on the follow-up `UPDATE`, which was the one statement left uncovered.
- F018 no-lead case: chose "record via `raise warning`" over "notify someone else." The original migration's own header (lines 74-84) already rejected guessing workspace owner/admin as a second, undocumented definition of "PM" for the has-a-lead case; extending that same guess to the no-lead case would be the same violation. `raise warning` is the same visibility mechanism the per-row exception handler already uses (line 199 of the original file) for "this happened, here's why, the run continues" — consistent, not a new pattern.
- results/page.tsx: added a `!metricsResult.ok` branch above the existing `metrics.length === 0` empty-state check, following the exact pattern `lib/queries/portal.ts`'s own F006f comment (line 314) and its consumer in `app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx:172-181` (`phasesResult.ok ? ... : <EmptyState icon={AlertTriangle} title="Couldn't load project phases" .../>`) already establish for `getProjectPhases`. `improvementsResult`'s existing `.ok ? data : []` fallback is unchanged — the spec's own callout (`results/page.tsx:76`) named only the metrics read, and the M4 gate finding is specifically about a metric rendering as unmeasured; treating the improvements list's own failure mode is out of scope here (see below).

## Out-of-scope work needed
- `improvementsResult.ok ? improvementsResult.data : []` in `results/page.tsx` has the same "failure reads as empty" shape as the metrics read did, just for the Improvements list rather than the Metrics cards. Not touched here because the spec's own callout named only the metrics read (line 76) and the M4 finding was specifically about a metric rendering as improved/unmeasured, not about the Improvements section. A future feature could apply the identical `!improvementsResult.ok` branch.
- No dedicated page-level integration test exists for `results/page.tsx`'s new `results-view-error` branch (there is also none for the pre-existing `phase-timeline-error` branch this pattern is copied from — confirmed by `grep -rln "phase-timeline-error" tests/` returning nothing), so this was verified by code reading + `tsc`/`eslint`, not a new automated test, consistent with how the rest of this mission treats that render pattern.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For the F018 no-lead case, chose "raise warning" (visible in the cron job's own Postgres logs) over inserting a new notification row for a fallback recipient (e.g. workspace owner/admin), because the original migration's own header already establishes that guessing a "PM" role outside `project_members.project_role = 'lead'` is exactly the kind of silent, undocumented redefinition this schema avoids. `raise warning` costs no new table/column and matches the existing per-row exception handler's own visibility mechanism one paragraph above it in the same function.

## Notes for the next worker
- Another worker was concurrently active in this working tree (F022, touching `docs.ts`, `project-site.ts`, `markdown-editor.tsx`, etc.) with uncommitted changes on disk throughout this session. My first `git commit` attempt accidentally picked up their already-staged files from a shared index — caught immediately via `git show --stat HEAD`, undone with `git reset --soft HEAD~1 && git reset`, and re-committed with only this feature's five files explicitly named. Final commit (`960dcec`) is 5 files, 251 insertions, 9 deletions — verify this if reviewing history around this timestamp.
- `npm run db:gen-types` was run once to confirm the F018 migration didn't require type regeneration (it didn't — the function signature is unchanged) and once more afterward because it had picked up the concurrent F022 worker's schema too; `lib/supabase/database.types.ts` was intentionally left un-staged/uncommitted here since none of its diff originates from this feature's own migration.
- Migration timestamp `20261015010000` was chosen as the next free slot after `20261014020000` (the latest F022 migration on disk at the time); re-check `ls supabase/migrations | tail` before choosing a new one if this file's neighbors have since changed.
