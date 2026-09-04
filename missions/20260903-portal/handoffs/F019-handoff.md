# Handoff: F019 — Portal Hours view and the burn-down chart

## Status
COMPLETE

## Assertions covered
AS-034: PASS — `getProjectHoursClient` (project_hours_client, F017) feeds `computeBurndownSeries`/`computeBurndownLayout` (components/portal/hours-burndown-chart.tsx), rendered as an inline SVG cumulative burn-down: solid 2px brand `Used` line with a light area fill and a directly-labelled emphasised endpoint, 2px dashed muted `Planned` line (budget spread evenly across the observed week range, disclosed in the caption), a labelled budget-ceiling rule, a three-item legend, and a crosshair (one shared tooltip element, `hours-chart-tooltip`) giving used/planned/difference for the hovered week. Unit tests `tests/unit/f019-hours-burndown-chart.test.tsx::test_AS_034_*` — 8/8 passing — cover the fixed-payload point count, the endpoint's value matching the final cumulative minutes, the ceiling sitting at the budget value, the planned curve's even spread, the no-budget failure case (used-only, no fabricated ceiling), and the "budget exists but nothing logged" (period-not-started) case rendering one honest line and no chart.
AS-038: PASS — `HoursByCategory` (components/portal/hours-by-category.tsx) renders single-hue horizontal bars with a direct numeric label per row, sourced from `project_hours_client`'s `by_category` field (already `coalesce(work_category, 'uncategorised')`, F017); `Uncategorised` renders as its own labelled row. Unit tests `test_AS_038_hours_by_category` (2/2 passing) cover every category having a stated value and the empty state. The By month table (page.tsx) aggregates the same weekly array up (no third read path), each row carrying its own stated hours value.

## Files changed
app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx
components/portal/hours-burndown-chart.tsx
components/portal/hours-by-category.tsx
components/portal/hours-tiles.tsx
tests/unit/f019-hours-burndown-chart.test.tsx

## Commands run
`npx vitest run tests/unit/f019-hours-burndown-chart.test.tsx` (0, 11/11 passing)
`npx vitest run tests/integration/f017-hours-migration.test.ts tests/unit/f018-time-tracking-category-render.test.tsx tests/integration/f005-portal-pages.test.ts` (0, 28/28 passing — no regression)
`npx tsc --noEmit` (0)
`npx eslint "components/portal/hours-burndown-chart.tsx" "components/portal/hours-by-category.tsx" "components/portal/hours-tiles.tsx" "app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx" "tests/unit/f019-hours-burndown-chart.test.tsx"` (0 errors)
`grep -rn "getProjectHoursTeam\|TeamHoursEntry\|project_hours_team" "app/(portal)" "components/portal"` (exit 1, no matches — see Decisions made / grep proof below)

## Decisions made
- **Grep proof for the side-effect verification**: `grep -rn "getProjectHoursTeam\|TeamHoursEntry\|project_hours_team" "app/(portal)" "components/portal"` returns no matches (exit code 1). `app/(portal)/.../hours/page.tsx` imports only `getProjectHoursClient` from `lib/queries/hours.ts`; no file under `components/portal/` imports anything from `lib/queries/hours.ts` at all except the two new files this feature adds (`hours-burndown-chart.tsx`, `hours-by-category.tsx`), which import only `ClientHoursWeek`/`ClientHoursCategory` (types) and the chart component itself never calls any RPC — the page is the only caller.
- **Single hue for category bars, no invented palette**: `HoursByCategory` uses `bg-brand` for every bar (the same token the burn-down chart's Used series uses) — identity comes from the row's own text label (`categoryLabel`), matching this feature's own explicit instruction and `status-distribution.tsx`'s established "text label AND colour, colour never alone" convention (grep-confirmed at `components/portal/status-distribution.tsx`).
- **Status tokens for Against-plan tile**: `text-status-done` when at-or-under plan, `text-status-waiting` when over — the same two tokens (`--status-done`/`--status-waiting`, `app/globals.css`) `overview-tiles.tsx`/`status-distribution.tsx` already use, per plan.md's Design constraint #3 ("never re-pick them per component").

## Out-of-scope work needed
- `project_budgets`' own `period_start`/`period_end` are not exposed to the client through any RPC (`project_hours_client` returns only `sold_minutes`, no dates). A follow-up could add a client-safe, date-only read (e.g. a narrower RPC or a `sold_minutes`-adjacent `period_start`/`period_end` pair) so the chart's "period" can be the actual budget period instead of the observed week range this feature discloses in its caption. Not done here because F017/F018 (already COMPLETE) deliberately built no such path and this feature's own scope is "reads `project_hours_client` only" — adding a new RPC or column would be a migration, out of this feature's file scope.
- No date-range picker on the portal Hours view (mirrors F018's own team-side "Out-of-scope work needed" note for the same reason) — the view always shows the full observed history through today.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No `missions/20260903-portal/clarifications/F019-clarification.md` file exists (the clarifications directory for this mission has no F019 entry — the feature spec itself contains no appended "Clarified implementation"/"Definition of done beyond what's in the spec body" sections either, so the spec body above is treated as complete). In its absence, per `worker-mcp-usage`'s ambiguity priority order (clarified spec → clarification file → tech-decisions → safest default), I resolved the two undocumented gaps as follows:
1. **"The period" the planned curve spreads across**: `project_hours_client` has no client-visible way to learn a budget's `period_start`/`period_end` (no client SELECT policy on `project_budgets` at all — confirmed by reading `supabase/migrations/20261010010000_f017_project_budgets_work_category_hours_rpcs.sql` and F017's own handoff). I query the RPC with a wide window (2000-01-01 through today) so its own "most recent overlapping budget" lookup naturally resolves to the started budget, then use the *observed week range within the returned data* (first billable week through the later of the last billable week or the current week) as "the period" for spreading the budget evenly — and disclose this explicitly in the chart's own caption ("Planned assumes the budget is spread evenly across the weeks shown here") rather than presenting it as the budget's official date range, per this feature's own "do not imply a precision the number does not have" instruction.
2. **Operationalising "a period that has not started"**: with no period-start date available at all (see #1), I read this degenerate case as "a budget exists (`sold_minutes` is not null) but zero billable minutes have been logged" (`weekly` is empty) — indistinguishable, with the data this feature's own RPC returns, from a period that genuinely hasn't started yet, and honest either way ("no chart, one honest line" renders identically for both). Documented at the top of `components/portal/hours-burndown-chart.tsx`.

## Notes for the next worker
- No MCP tools used — this is a pure UI feature with no live schema/policy change, per `worker-mcp-usage`'s decision tree ("Pure UI feature → No MCP unless spec requires live CMS/data fetch").
- `computeBurndownSeries`/`computeBurndownLayout`/`isoWeekToMonday` (`components/portal/hours-burndown-chart.tsx`) are exported pure functions, same "layout math kept separate from rendering, exported for direct unit testing" convention `phase-timeline.tsx`'s `computePhaseTimelineLayout` established (F006) — reuse them directly if a future feature needs the same ISO-week-to-Monday conversion or gap-filling logic (e.g. F018's team-side hours view, if it ever grows its own chart).
- If a follow-up ever adds a client-visible `period_start`/`period_end` read (see Out-of-scope above), update this chart's "period" logic and caption to use the real dates instead of the observed-week-range fallback — the fallback and its disclosure exist specifically because that data isn't available yet, not because it's the preferred long-term basis.
