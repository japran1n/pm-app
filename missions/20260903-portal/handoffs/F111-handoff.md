# Handoff: F111 — Weekly delivery rhythm (docs/client-portal-visual-plan.md 3.6)

## Status
COMPLETE

## Assertions covered
No assertion IDs are assigned to this feature — it was commissioned directly
(no `missions/20260903-portal/features/F111-*.md` spec exists, and it is not
listed in `validation-contract.md`). Coverage instead follows the task's own
instructions: unit tests named `test_F111_*` for the definition of "shipped
in week N", the no-completed-work guard, the empty-week guard, and the
client-visibility/category filters, plus a live curl verification of the
rendered page (below).

## Files changed
lib/portal/weekly-delivery.ts (new)
lib/hours/burndown-series.ts (exported `isoWeekOf`, no behaviour change)
lib/queries/portal.ts (added `getPortalWeeklyDelivery`)
components/portal/weekly-delivery-chart.tsx (new)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx (wired the chart in)
tests/unit/weekly-delivery-series.test.ts (new)
tests/unit/weekly-delivery-chart.test.tsx (new)
tests/unit/portal-weekly-delivery-query.test.ts (new)
missions/20260903-portal/handoffs/F111-handoff.md (new, this file)

## Commands run
`npx vitest run tests/unit/weekly-delivery-series.test.ts tests/unit/weekly-delivery-chart.test.tsx tests/unit/portal-weekly-delivery-query.test.ts tests/unit/server-client-boundary-imports.test.ts` (0, 23 passed)
`npx tsc --noEmit` (0)
`npm run build` (0)
`curl http://localhost:3000/dev-login?email=nina@demo.test` then `curl http://localhost:3000/portal/acme-studio/p/b1e02e94-03fb-48d3-8e4c-fd34c868919b` with `.env` sourced (200, real markup, no error boundary — see Notes)

## Decisions made

- **Definition of "shipped in week N"**: a client-visible task counts once,
  in the ISO week of the LAST `task_activity` row where
  `kind='field_changed'`, `field='status'`, for a task whose CURRENT
  status resolves to the `done` category — provided the task is still in
  that category today. Reopened-then-redone tasks are credited for the
  most recent completion, not the first; a task reopened and never
  refinished drops out of every week's count until it is redone. This is
  read directly from `task_activity`, not inferred from `tasks.updated_at`
  — `updated_at` is bumped by ANY field write on the row (a later title
  edit, reassignment, or due-date nudge), so it would misdate old,
  already-shipped work as freshly shipped. Full rationale is in
  `lib/portal/weekly-delivery.ts`'s own header comment.
- **Fallback for tasks with no matching `task_activity` row** (predates
  F194/F195's 2026-08-22/23 rollout, or was seeded/imported already done):
  falls back to the task's own `created_at`, explicitly never
  `updated_at` — `created_at` is immutable and cannot be pulled forward by
  an unrelated later edit the way `updated_at` can, even though it is
  still an approximation, disclosed as such in the chart's caption
  ("counted in the week they were last marked done") rather than implied
  as exact.
- **"Done" resolved via `project_statuses.category`**, not a hardcoded
  `status === 'done'` string check — same category-resolution convention
  `getProjectPhases`/`getPortalOverview` already use in this same file
  (`categoryByStatusId` falling back to a name match), grepped and
  confirmed at `lib/queries/portal.ts:94-108` and the `getProjectPhases`
  body just above it, so a project that renamed its default columns still
  resolves correctly and this file doesn't grow a second, disagreeing
  definition of "done".
- **Range = the project's own span**: from the ISO week containing
  `projects.start_date` (falling back to the earliest client-visible
  task's `created_at`, then to today, if `start_date` is null) through the
  ISO week containing today — never a fixed trailing window. A stray
  completion date outside that span (clock skew, or a fallback
  `created_at` fractionally before the project's own start row) is
  clamped into the nearest boundary week rather than silently dropped or
  allowed to stretch the visible range.
- **Zero weeks are real, drawn entries**, not omitted — every week in the
  span appears in the series and the SVG (a 0-height bar, not a missing
  one), so "no completed work yet" and "a week with nothing shipped" both
  read as a deliberate zero rather than an absence. A genuinely
  zero-height bar (no fake minimum sliver) plus the always-present
  baseline, hover hit-target, and week label make that absence legible as
  "this week: 0" without misrepresenting the data as having shipped
  something.
- **Reused `enumerateIsoWeeks`/`isoWeekOf` from `lib/hours/burndown-series.ts`**
  (exported `isoWeekOf`, previously module-private) rather than
  reimplementing ISO-8601 week math a second time — same source of truth
  the Hours burn-down chart already uses.
- **Placement**: directly after `BudgetBar`, before the two-column grid
  (phase timeline + waiting-on-you + activity feed). Reasoning recorded in
  the page's own comment: this is the second full-width, single-scale,
  one-glance figure on the page (after the budget bar), answering "and is
  that good?" without a click, and it pairs with the phase timeline
  immediately below it as "proof of past motion" next to "proof of
  current motion" — not competing with the tiles above, which are
  current-state numbers, not history. The plan's "3.6" is a section
  number in the source doc, not a layout instruction; the bottom of the
  page was deliberately not assumed correct just because the plan lists
  it last.
- **Chart rules followed**: one scale (bars share one `maxCount`), thin
  18px bars with a 2px gap, 4px rounded rect ends anchored to the
  baseline, a single recessive `stroke-border` baseline (no gridlines),
  chart text on `fill-muted-foreground`/`fill-foreground` theme tokens,
  no legend (single series, named by the card's own title), a shared
  hover tooltip with a hit target wider than the mark (matching
  `hours-burndown-chart.tsx`'s exact convention), and one direct label
  (the running total) rather than a number stamped on every bar. The
  chart sits inside its own `overflow-x-auto` div so a long project's
  wide chart scrolls in its own card, not the page.

## Out-of-scope work needed

- **`scripts/seed-demo.mjs` never backdates `created_at` or writes
  `task_activity` rows** for any seeded task (grepped: no `task_activity`
  insert anywhere in that file outside the wipe/delete step; every task
  insert omits `created_at`, so it defaults to `now()` at seed-run time).
  Verified live against `acme-studio`'s Website Redesign: all 7 completed,
  client-visible tasks fall into the single current ISO week (`2026-W36`),
  with the three earlier weeks in the project's span at a true zero — the
  chart is correct and honest given the data it's fed, but doesn't
  demonstrate a multi-week "steady motion" story the way the visual plan's
  own framing implies it should. A future feature could backdate a subset
  of Website Redesign's done tasks' `created_at` (or, better, write real
  `task_activity` field_changed/status rows via the RPC at staggered past
  timestamps) so this and other history-dependent charts (the burn-down
  already has real weekly spread from `time_entries`, which IS backdated)
  have a representative demo shape. Not done here: it touches shared seed
  infrastructure used by every other feature's demo data, not the client
  portal itself, and risks unintended side effects on data other
  tests/features may already depend on.
- Part 4 of the visual plan (blocked-phase reason field, weighted vs. count
  progress decision, `launch_confidence` history) is explicitly out of
  scope for this feature and untouched.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: No feature spec or clarification file exists for this
work (it was assigned directly, outside the normal F-numbered mission
pipeline) and it carries no validation-contract assertion IDs. Treated
`docs/client-portal-visual-plan.md` section 3.6 plus the direct task
instructions as the full spec, and applied `missions/20260903-portal`'s own
existing conventions (query result shape, category resolution, chart
component structure, theme tokens) throughout rather than introducing new
patterns.

AUTONOMOUS_DECISION: Chose "last transition into a done-category status,
task still done today" over "first-ever transition into done" as the
completion definition — see Decisions made above and the full rationale in
`lib/portal/weekly-delivery.ts`'s header comment.

## Notes for the next worker

- Live verification: `set -a; source .env; set +a`, then
  `curl -s -c /tmp/jar http://localhost:3000/dev-login?email=nina@demo.test`
  followed by
  `curl -s -b /tmp/jar http://localhost:3000/portal/acme-studio/p/b1e02e94-03fb-48d3-8e4c-fd34c868919b`
  returns `200` with the chart's markup (`data-testid="weekly-delivery-chart"`,
  four `weekly-delivery-bar-2026-W3{3,4,5,6}` rects, total label
  `"7 client-visible tasks shipped"`) and no error boundary/digest. There is
  a SECOND, unrelated "Website Redesign" project in a `demo-workspace`
  workspace with zero project members and a null `start_date` — that one
  is orphaned leftover seed data, not the portal-enabled project; use the
  `acme-studio` one (`b1e02e94-03fb-48d3-8e4c-fd34c868919b`) for any
  further manual checks.
- To visually verify: open
  `http://localhost:3000/portal/acme-studio/p/b1e02e94-03fb-48d3-8e4c-fd34c868919b`
  as `nina@demo.test` (via `/dev-login?email=nina@demo.test`) and screenshot
  the Overview page. Check: (1) the "Weekly delivery rhythm" card sits
  directly under the budget bar, above the phase timeline; (2) four bars
  render, three at zero height flush to the baseline and one full-height
  bar in the rightmost (current) week — this is real, not a rendering
  bug, per the seed-data limitation noted above; (3) hovering the tall bar
  shows a tooltip ("Week of 31 Aug" / "7 shipped"); (4) hovering a
  zero-height bar's column still shows a tooltip with "0 shipped" (the
  hit target is the full column width, not just the visible bar); (5) in
  dark mode, the bar and axis line are both visibly legible (theme
  tokens, not hardcoded colours); (6) resizing the browser narrow does not
  cause the page body to scroll sideways — only the chart's own card
  should gain a horizontal scrollbar if it were ever wide enough to need
  one (this project's 4-week chart is far too narrow to trigger it; a
  months-old project would be the real test).
- No MCP tools were used — this feature is pure application code/queries
  against tables already covered by existing RLS policies (`tasks`,
  `task_activity`, `project_statuses`), no schema or policy change was
  needed.
