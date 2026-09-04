# Handoff: F021b — the hours view describes one budget period

## Status
COMPLETE

## Assertions covered
AS-034: PASS — `test_AS_034_primary_success_the_two_period_fixture_reports_only_the_current_periods_used_remaining_and_series_not_the_sum` (tests/integration/f021b-hours-period-scoping.test.ts) plus `test_AS_034_failure_a_single_period_project_reports_that_periods_own_figures_unchanged`. Also verified F019's existing chart unit tests and F017's RPC integration tests still pass unmodified.

## Files changed
supabase/migrations/20261015020000_f021b_hours_period_scoping.sql
lib/queries/hours.ts
app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx
lib/supabase/database.types.ts (regenerated)
tests/integration/f021b-hours-period-scoping.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20261015020000_f021b_hours_period_scoping.sql` (0)
`npm run db:gen-types` (0)
`npx vitest run tests/integration/f021b-hours-period-scoping.test.ts` (0, 5 passed)
`npx vitest run tests/integration/f017-hours-migration.test.ts tests/unit/f019-hours-burndown-chart.test.tsx` (0, 24 passed — side-effect verification per the spec's definition of done)
`npx tsc --noEmit` (0)
`npx eslint "app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx" lib/queries/hours.ts tests/integration/f021b-hours-period-scoping.test.ts` (0)

## Decisions made

- **Root cause confirmed before touching anything:** the fixture test's third case (`failure test: querying the OLD unbounded window on this same fixture reproduces the defect`) calls `project_hours_client` with the pre-fix `2000-01-01 .. today+30d` window against the two-period fixture (closed period: 2400 min used of 2400 sold; current period: 300 min used of 2400 sold) and asserts it reports **2700** minutes used — reproducing the spec's "Used 45h, Remaining 0h, +5h Over" defect verbatim (2700/60 = 45h against a single 2400-minute/40h `sold_minutes`). This test passes both before and after the fix, by design, to document what the old call shape does; it is not itself the regression guard.
- **The regression guard** is the primary-success test, which resolves the current period via the new `project_current_budget_period` RPC first, then calls `project_hours_client` scoped to that period's own `[period_start, period_end]`, and asserts **300** (not 2700, not any other sum) — this is what changed from BLOCKED to PASS by this feature's fix, and is what would fail again if the wide-window call ever came back.
- **New RPC, not a change to `project_hours_client`'s own aggregation logic:** `project_hours_client` keeps its existing signature and behaviour (it already aggregates whatever `[p_from, p_to]` range it's given — that generality is legitimate and is exactly what F017's own tests already exercise with a single-period range). The defect was entirely in *what range the page passed in*. Fix: a new `project_current_budget_period(p_project_id)` function picks exactly one period (current, or most recently ended if none is current) and the page now queries `project_hours_client` with that period's own bounds instead of `WIDE_FROM..today`. This keeps the "two read paths, not one with a flag" precedent (grep: `supabase/migrations/20261010010000_f017_project_budgets_work_category_hours_rpcs.sql:5-9`, F017's own migration header) intact — no existing SECURITY DEFINER function's behaviour changed, only the caller's arguments.
- **No client SELECT policy on `project_budgets` was added or needed.** `project_current_budget_period` is itself a SECURITY DEFINER function gated by `client_gate` (grep: `supabase/migrations/20261001010000_f016d_one_client_gate.sql:130-148`), matching `project_hours_client`'s own gating, and returns only `period_start`, `period_end`, and a boolean — never `sold_minutes`, `rate_amount`, `currency`, or `note`, all of which stay behind the existing "only through `project_hours_client`" path documented in `project_budgets`' own migration header (`20261010010000...sql`, the `project_budgets_select_team` policy comment).
- **"Several past periods" disclosure:** chose the "state plainly" option from the spec's two honest choices (a switcher UI vs. a plain statement), not a switcher — a full period-history view was out of the estimated 2h and not requested by any assertion. The page now renders a `data-testid="hours-period-scope"` line stating the exact `[period_start, period_end]` window and, when `has_other_periods` is true, "Earlier periods are not included in these figures." This satisfies scope item 2 without exposing any past period's own figures.
- **No-budget fallback preserved exactly:** when `getProjectCurrentBudgetPeriod` returns `null` (no budget row at all), the page falls back to the original `WIDE_FROM..today` window unchanged, so `sold_minutes` stays `null` and F019's empty-state / "no budget set yet" treatment is untouched — verified by re-running F019's existing chart unit tests unmodified (24/24 pass) and by this feature's own "no budget at all returns no current period row" test.
- **Fallback ordering inside the new RPC when no period covers today:** most-recently-ended period first (`period_end < current_date order by period_end desc`), then most-recently-started as a last resort for a project with only a future, not-yet-started budget. This matches the spec's "the current one, or the most recent if none is current" literally.
- Migration timestamp `20261015020000` chosen to sort after the existing `20261015010000_f021c_budget_sweep_atomic_and_leadless.sql` (the latest migration present when this feature started) to avoid collision with another worker's file.

## Out-of-scope work needed

- A true period-switcher (letting a client browse past periods' own figures) was explicitly declined per the spec's "either is honest" framing — noted here in case a future feature wants it. Would need a client-visible read path onto `project_budgets` history (a new SECURITY DEFINER function returning a list of `{period_start, period_end}` pairs only, still withholding `sold_minutes`/`rate_amount`/`note` for past periods unless a further feature decides otherwise), plus UI for selecting among them.
- `hours-burndown-chart.tsx`'s own aria-label caption (`buildChartSummary`) still says "through the week of X, against Y budget" rather than stating the period's own start date explicitly. It's accurate now that the underlying data is correctly scoped, but a future polish pass could make it state the period's `[period_start, period_end]` verbatim to match the new banner above it. Not required by this feature's DoD ("the caption describes the window the numbers actually cover" — it does, since the window and the caption now describe the same, correctly-scoped data) so left unchanged.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: No `clarifications/F021b-clarification.md` file exists for this feature (checked: `ls missions/20260903-portal/clarifications/ | grep F021b` — no match). Resolved the "current vs most recent" period-selection rule and the "state plainly, don't build a switcher" scope-item-2 choice directly from the feature spec's own wording, per the ambiguity priority order in the `worker-mcp-usage` skill (clarified spec text ranks above all other sources).

## Notes for the next worker

- The fixture that would have caught this before it shipped is `tests/integration/f021b-hours-period-scoping.test.ts`'s `"two budget periods, entries in both"` describe block. Its `failure test: querying the OLD unbounded window...` case is deliberately still passing (asserting 2700) — it's a live demonstration of the defect shape, not a regression guard; the regression guard is the primary-success test asserting 300.
- Before the fix: manually confirmed by running the wide-window RPC call against the two-period fixture (closed 2025-shape period: 2400/2400 min used; current-shape period: 300/2400 min used) — it reported total used = 2700 minutes (45h) against `sold_minutes` = 2400 (the more-recently-starting budget, per the old `order by period_start desc limit 1` selection), i.e. Remaining = 2400 − 2700 = −300 → clamped to 0 by `HoursTiles`' `Math.max(remainingMinutes, 0)`, and Against plan = +300 min (+5h) over. Matches the spec's reported symptom exactly.
- After the fix: the same fixture, queried through `project_current_budget_period` → `project_hours_client` scoped to that period, reports used = 300 minutes (5h) against `sold_minutes` = 2400 (40h) → Remaining = 2100 (35h), no overrun.
- No MCP tools used — this mission's registry does not list a Worker-usable Supabase MCP for this feature (per the task instructions: "The Supabase MCP is not authorised — use the CLI"); schema changes went through `npm run db:apply` against the real project directly, and were verified by running the integration test against that same live database.
