# M4 Scrutiny — hours and results (F017, F018, F019, F020, F021)

Mission: 20260903-portal · Milestone M4 · Reviewed at `bd5e44c`
Read-only: no code, test, migration or contract file modified. Full vitest suite
deliberately **not** run (a worker is active; a full run manufactures auth
rate-limit failures). Findings verified against the **applied catalog** and the
migration/TSX source, not against the handoffs.

## VERDICT

**M4 does not pass — three blockers.**

Two of them are the same shape as the ones M1–M3 kept producing: a guarantee
written into a comment and a test, but not into the object that would have to
enforce it. The third is arithmetic — the portal's central number is wrong for
any project on its second budget period.

Nothing in M4 leaks money or identity to a client. The privacy work in F017/F019
is the strongest part of the milestone. Every table M4 added has RLS, correct
two-tier policies and pg_temp-pinned predicates; the M3-round-4 lesson (a fix's
own bookkeeping table in scope of nothing) was **not** repeated — F016l closed
that table and the applied catalog now has zero `relrowsecurity = false` tables
in `public`, and M4 added no bookkeeping table of its own (the sweep reuses
`notifications`).

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-033 | PASS | — | `project_budgets` with `EXCLUDE USING gist` overlap constraint, `sold_minutes > 0`; writer-gated CRUD in RLS **and** in `withAuthz`; F018's integration test proves viewer and client are rejected at the DB layer. |
| AS-034 | **FAIL** | **blocker** | The used curve is summed over a 26-year window while the planned curve comes from one budget; the two lines are not on the same period. B1. |
| AS-035 | PASS | — | `te.billable` in both CTEs of `project_hours_client`; the test would catch removal from either one independently. |
| AS-036 | PASS | — | Return value is an explicit three-key `jsonb_build_object`; no `select *`, no `row_to_json`, no `profiles` join, no `te.note`/`te.user_id` selected in any branch; the error branch is a fixed string. Test asserts on `JSON.stringify(data)`, so a leak under a different key still fails it. |
| AS-037 | PASS | — | No `client_visible` predicate anywhere in the client RPC and no `tasks` column ever selected, so inclusion is the default and the title cannot leak; the test proves inclusion positively (60 min in `development`), not just absence. |
| AS-038 | PASS | — | Both the portal and team views render a label + `formatDuration` per bucket; NULL folds to a labelled `uncategorised` bucket in SQL. One hue only, so nothing is colour-alone. |
| AS-039 | PASS | — | `project_metrics` stores value, unit, target, CHECK-constrained source, plus `direction`; round-tripped through the DB in test. |
| AS-040 | **FAIL** | **blocker** | The trigger is correct and correctly scoped, but the flag it reads is writable by any active workspace member and the row can be deleted and recreated. B2. |
| AS-041 | **FAIL** | **blocker** | `deriveMetricMeasurementStatus` never compares `measured_at` to `baseline_at`; a pre-baseline snapshot renders as "Improved". B3. |
| AS-042 | PASS | — | Paired Before/Now bars, dashed target tick, Before/Now/Target value rows with units and dates; target-less metrics omit the tick honestly; no division anywhere, so no NaN/Infinity at `baselineValue = 0`. |

## Blockers

### B1 — the portal's hours figures mix budget periods

`app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx:42`
(`WIDE_FROM = "2000-01-01"`) and `:70`, against
`supabase/migrations/20261010020000_f017b_hours_client_window_fn_fix.sql`
(the `sold_minutes` lookup, ~line 100).

`project_hours_client` aggregates `weekly` and `by_category` over the **whole**
`[p_from, p_to]` range, but picks `sold_minutes` from a single budget chosen by
mere *overlap* with that range, `order by pb.period_start desc limit 1`. The
`EXCLUDE` constraint stops budgets overlapping each other; it does nothing about
a request range spanning two of them.

Trigger: a project with a closed 2025 budget (40h, fully used) and a current
2026 budget (40h, 5h used). The portal shows Used 45h, Remaining 0h, "Against
plan +5h Over", and a ceiling line at 40h. Every tile and the entire burn-down
are wrong, and wrong in the direction that starts a client conversation about an
overrun that did not happen.

The header comment at `:35-41` argues the wide window is deliberate and that the
chart's caption discloses the observed range. The caption does not repair the
arithmetic: the *numbers* are cross-period even if the *dates* are disclosed.
The fix is to resolve the current budget period first and pass its
`period_start`/`period_end` as the window — or to have the RPC return the chosen
budget's own dates and clamp the series to them.

Aggravating, same area:
- `hours-burndown-chart.tsx:60-71` — `lastWeek = max(lastDataWeek, todayWeek)`,
  so a budget whose work ended 18 months ago enumerates ~80 empty weeks and
  spreads the planned line evenly across them, implying scheduled work in weeks
  the budget never covered. Chart grows to ~4500px.
- `hours-burndown-chart.tsx:186-190` — with a single week, `plannedPath` is a
  bare `M x,y` moveto and paints nothing while the legend still advertises
  "Planned". First week of a project shows an empty chart with a full legend.

### B2 — the baseline freeze is not enforceable

`supabase/migrations/20261013010000_f020_...sql:62` (column) and `:191-194`
(trigger).

The trigger `prevent_frozen_baseline_update` is right: it guards exactly
`baseline_value` and `baseline_at`, it is `SECURITY DEFINER` with
`search_path = public, pg_temp`, it fires for service_role too (the F020 test
proves this by attacking it as `admin`), and the test proves the un-frozen case
still permits edits and that unrelated columns stay editable — the F011b
over-guard lesson was learned. The problem is everything around it.

1. **The flag is unprotected.** The only UPDATE policy on `projects` is
   `projects_update_active_members`, qual
   `deleted_at IS NULL AND is_active_workspace_member(workspace_id)` — no role
   restriction. The existing `enforce_project_portal_and_launch_field_role`
   trigger guards `portal_enabled*` and the three launch fields and nothing
   else. F020 added a new sensitive column to that table and did not extend the
   guard. Trigger: `PATCH /rest/v1/projects?id=eq.<pid>` with
   `{"baseline_frozen_at": null}`, then `PATCH /rest/v1/project_metrics` with a
   new `baseline_value`, then re-freeze. Two round trips, no audit entry, and
   the portal's "baseline frozen on <date>" sentence still renders. A **client
   or viewer** can flip the flag in either direction, because that policy admits
   any active member. `lib/actions/metrics.ts:620` not exposing an unfreeze
   input is application-level only and irrelevant to a direct PostgREST call.
2. **DELETE-then-INSERT.** The trigger is `BEFORE UPDATE` only.
   `project_metrics_delete_team` and `..._insert_team` gate on
   `is_project_workspace_writer` with no frozen check, as does `deleteMetric`
   (`lib/actions/metrics.ts:357`). A writer drops the frozen metric and
   re-inserts it under the same name with a new baseline; snapshots cascade
   away, so the "before" is gone entirely.
3. **Reinterpretation without a write.** `direction` and `unit` stay editable on
   a frozen metric (deliberate, per the migration header `:155-159`). Flipping
   `direction` from `lower` to `higher` turns every "Regressed" badge into
   "Improved" with no baseline write at all. The frozen number is untouched; its
   meaning is not.

The integration test attempts none of these three. It proves the trigger, and
the trigger is not the weak link.

### B3 — a pre-baseline snapshot is presented as an improvement

`lib/queries/metrics.ts:207-243` (`deriveMetricMeasurementStatus`) and
`:187-213` (`getProjectMetricsWithLatestSnapshot`).

The function's own comment reads "a metric with no **post-baseline** snapshot is
'not yet measured'". Its parameter type is
`Pick<ProjectMetric, "baselineValue" | "direction">` — `baselineAt` is not in
scope, and `measuredAt` is never compared to anything. `getMetricSnapshots`
orders by `measured_at desc` and the first hit wins regardless of date.

Trigger: a metric with `baseline_at = 2026-03-01`, `baseline_value = 100`,
`direction = 'higher'` and one historical snapshot `measured_at = 2026-01-15,
value = 130`, with no post-baseline measurement at all. The card renders
"Improved" in `text-status-done`, a green Now bar, and "Now 130 as of 15 Jan
2026". That is precisely the fabricated improvement AS-041 exists to forbid.

`baseline_frozen_at` is read on the results page (`results/page.tsx:66-73`) only
to compose a header sentence; it never gates measurement validity.

The AS-041 test block (`f020-...test.ts:352-400`) is unit-level against
`deriveMetricMeasurementStatus`'s own signature, so it cannot observe the
missing comparison — a test that mirrors the implementation rather than the
assertion. `metric-comparison-card.test.tsx` is honest about the two cases it
covers (it *would* fail if the not-measured branch were replaced by a 0% bar)
but has no pre-baseline case.

## Majors

**M-1 — the sweep's one unguarded statement is the one most likely to throw.**
`20261012010000_f018_budget_threshold_sweep.sql:210`. The per-row
`begin … exception when others then raise warning … continue` closes at `:202`;
`update notifications set project_id = … where id = v_notification.id` sits
outside it. The dedup unique index is partial on `project_id is not null`, so
`create_notification` inserts with a NULL `project_id` and a duplicate is only
detected at *this* UPDATE. Two overlapping invocations (a manual RPC run
alongside the 06:30 cron), or any pre-existing `budget_threshold_*` row the
`NOT EXISTS` misses, raises out of both loops, aborts the transaction and rolls
back every other project's notification in that run — the exact "one bad row
kills the run" mode the migration header claims to have defended against. The
spend `select` at `:118` and the lead loop are likewise unguarded.

Otherwise the sweep is sound on both historical failure modes: the dedup key is
per project / per lead / per threshold / per period (backed by a real unique
index, verified live), so it re-arms on a new period and never nags inside one;
`sweep-project-budget-thresholds` is live in `cron.job` as jobid 4,
`30 6 * * *`, `active = true`.

**M-2 — the sweep is silent for a project with no lead.** The recipient loop
selects `project_members` with `project_role = 'lead'`. A project without one
crosses 100% of its budget and nobody is told, with no warning raised.

**M-3 — a query failure is rendered to the client as "nothing measured yet".**
`results/page.tsx:76-77`: `metricsResult.ok ? data : []`, same for improvements.
An RLS or DB error collapses to the EmptyState "No results yet. Once the team
records a baseline…". The client is told a falsehood about the team's work.

**M-4 — `f016i` anon-execute allow-list matches on `proname` only.**
`tests/integration/f016i-anon-execute-catalog.test.ts:88`. F017 added ~90
`btree_gist` function names after `create extension` slipped them past the
event trigger with `anon=X`; the reasoning for exempting them is sound, but the
allow-list has no signature. Any future `public` function named e.g.
`date_dist` or `gbt_text_consistent` is now silently exempt from the guard M3
spent three rounds building. F017's `20261010030000` `do $$ … revoke $$` block
is admitted in its own header to be a no-op.

**M-5 — F017's own AS-033 tests prove nothing about authorisation.** Every
budget insert in `f017-hours-migration.test.ts` uses the service-role `admin`
client. Delete all four `project_budgets` policies and those tests stay green.
F018's suite covers the gap, so the assertion passes; the file is misleading.

## Minors

- `hours/page.tsx:145` — `Math.round((minutes / summary.soldMinutes) * 100)`
  guarded only by `!== null`; unreachable today (`sold_minutes > 0` CHECK) but
  the wrong guard.
- `hours-tiles.tsx:10-35` re-implements the unexported `Tile` from
  `overview-tiles.tsx`; `results-improvements.tsx:22-33` hand-rolls an empty
  state instead of `EmptyState`, which the same page uses 40 lines earlier.
  Both violate "reuse before building".
- Two independent `CATEGORY_LABELS` literals (`team-hours-view.tsx:38`,
  `time-tracking.tsx:101`); type-checked against the shared enum, so keys cannot
  diverge, but the human-facing labels can.
- Both hours RPCs drop entries on soft-deleted tasks (`t.deleted_at is null`),
  so billable hours already sold against vanish from the client's figure.
  Silent and untested.
- `20261013010000:431` storage INSERT policy casts
  `nullif(split_part(name,'/',2),'')::uuid` unguarded — a malformed path raises
  `22P02` rather than denying cleanly. No bypass.
- `measurement-panel.tsx:421` sets `latestSnapshot: null` unconditionally after
  deleting a snapshot, so a metric with older snapshots reads "Not yet
  measured" until reload. Fails in the honest direction.
- AS-038 assertions in `f019-hours-burndown-chart.test.tsx` are raw-markup
  substring checks (`toContain("2h")` also matches "12h"), and no test covers a
  0-hour category.
- Stale comment at `f019-hours-burndown-chart.test.tsx:63-65` says "900 used";
  the fixture's endpoint is 1200.

## Answering the specific questions put to this review

**Money and privacy — clean.** `project_hours_client` returns an explicit
three-key object built from per-row `jsonb_build_object`; no task column is ever
selected (tasks is joined only to scope by `project_id`), `te.note` and
`te.user_id` appear in no CTE, no `profiles` join exists, and the error branch
is a constant string. A future `time_entries` column cannot ride along. The
seeded-payload check exists and is the right shape: it asserts against
`JSON.stringify(data)`, not named fields. Both RPCs are `SECURITY DEFINER`,
`search_path = public, pg_temp`, `proacl = {postgres, service_role,
authenticated}` — no anon (verified live). `project_hours_client` gates on
`client_gate(p_require_client_role => true)`; `project_hours_team` refuses when
`is_project_client(p_project_id)`, so a client calling it gets `42501`. F019's
grep claim holds: a sweep of all of `app/(portal)` and `components/portal` finds
zero references to `project_hours_team`, `time_entries`, `users` or `profiles`.

**What M4 added that nothing checks — the M3-round-4 question.** Asked and
answered in the negative: `select relname from pg_class … where nspname='public'
and relkind='r' and relrowsecurity = false` returns **zero rows** on the applied
catalog. `project_budgets`, `project_metrics`, `metric_snapshots` and
`project_improvements` all have RLS with `to authenticated` policies in the
`tasks_select_client` two-tier shape; every predicate function they call is
`SECURITY DEFINER` with `pg_temp` pinned. anon holds only the Supabase blanket
table grants (identical to pre-existing `project_decisions`) and has no policy,
so it reads and writes nothing. `project_budgets` deliberately has **no** client
SELECT policy — the client sees sold hours only through the RPC. The new
functions are correctly gated (table above); `prevent_frozen_baseline_update`
and `sweep_project_budget_thresholds` are `postgres`/`service_role` EXECUTE
only. No new bucket; improvement images resolve through
`getImprovementImageSignedUrl` (1h TTL, never persisted) behind a storage policy
plus four server-side checks. M4 introduced **no** unowned object. The one
weakening of an existing guard is M-4 above.

**Can a client reach any of it?** No, with the single exception in B2.1: a
client is an active workspace member, so `projects_update_active_members` lets
them PATCH `baseline_frozen_at`. They cannot change a baseline value (that needs
`is_project_workspace_writer`) — but they can freeze or unfreeze the project.

**Did any M4 test assert something it cannot observe?** Yes, one:
`f020-...test.ts:352-400` asserts AS-041 by calling
`deriveMetricMeasurementStatus` with hand-built arguments that omit the very
field (`baseline_at` / `measured_at`) the assertion turns on. It cannot fail for
the reason AS-041 exists. Everything else in M4 asserts observable output —
notably `metric-comparison-card.test.tsx`, which asserts rendered text and
testids rather than colours, and would genuinely fail if the not-measured branch
were replaced by a 0% bar.

## Recommended follow-up features

**F022 — clamp the portal hours window to one budget period.** The Hours view
currently asks `project_hours_client` for `2000-01-01 → today` and pairs the
resulting all-time totals with a single budget's `sold_minutes`, so a project on
its second budget period reports the first period's spend as an overrun of the
second. Resolve the applicable budget period server-side before the RPC call and
pass its `period_start`/`period_end` as the window, or extend the RPC's return
value with the chosen budget's own dates and clamp the weekly series to them;
either way the used curve, the tiles and the planned curve must describe the
same interval. While in the chart, stop extending the planned line across weeks
after the budget's `period_end` (`hours-burndown-chart.tsx:60-71`) and render a
visible point marker so a single-week period is not a blank chart under a full
legend (`:186-190`). Tests must cover: two adjacent budget periods with spend in
both, a period entirely in the past, a single-week period, and a gap week in the
middle of a period — asserting rendered tile text, not helper return values.

**F023 — make the baseline freeze actually immutable.** Three holes, one
feature. Add `baseline_frozen_at` to the guarded set of the existing
`enforce_project_portal_and_launch_field_role` trigger (or a sibling) so that it
may transition only NULL → a timestamp, only by a workspace writer, and never
back to NULL or to a different timestamp; today any active workspace member,
including a client or viewer, can flip it over PostgREST. Add a `BEFORE DELETE`
trigger on `project_metrics` refusing deletion of a metric whose project is
frozen, closing the delete-then-reinsert path. Decide and enforce a policy for
`direction` and `unit` on a frozen metric — either freeze them too, or record
the change as an audited event surfaced in the portal — because flipping
`direction` converts every "Regressed" badge to "Improved" without touching a
baseline value. Tests must attack each path directly as both `authenticated` and
service_role: PATCH the flag to null, delete-and-reinsert the metric, and flip
`direction`, each asserting the error **and** re-selecting to confirm the stored
values.

**F024 — derive measurement status from the baseline date.** Give
`deriveMetricMeasurementStatus` the metric's `baselineAt` and the snapshot's
`measuredAt`, and return `not_measured` when the latest snapshot predates the
baseline; `getProjectMetricsWithLatestSnapshot` should select the latest
**post-baseline** snapshot rather than the latest snapshot outright. The
function's own comment already claims this behaviour, which is why no test
caught its absence. Add cases for: a snapshot dated before `baseline_at` and no
other, a pre-baseline and a post-baseline snapshot together (the post-baseline
one must win regardless of ordering), a snapshot dated exactly on `baseline_at`,
and a metric with a null `baseline_at`. Assert through the rendered card, not
through the helper alone. In the same feature, replace
`results/page.tsx:76-77`'s `ok ? data : []` with a real error branch so a failed
query is never rendered to the client as "the team hasn't measured anything
yet".

**F025 — harden the budget threshold sweep's transaction boundary.** Move the
`update notifications set project_id = …` at
`20261012010000_f018_budget_threshold_sweep.sql:210` inside the per-row
`begin … exception … continue` block, and wrap the per-budget spend query and
the lead loop the same way, so no single project can abort the run and silence
every other project's notification — the partial unique index means this UPDATE
is precisely where a duplicate surfaces. Warn (rather than pass silently) when a
budget crosses a threshold on a project with no `project_role = 'lead'` member,
so the notification is not simply dropped. Tests should cover two overlapping
invocations, a project with no lead, and a threshold crossing after both a
`sold_minutes` raise and a `period_start` edit.

**F026 — pin the f016i anon-execute allow-list to signatures.** The allow-list
at `tests/integration/f016i-anon-execute-catalog.test.ts:88` grew by ~90
`btree_gist` entries when F017's `create extension` slipped them past the event
trigger, and it matches on `proname` alone. Key each entry on the full
identity argument list (or on the extension that owns the function via
`pg_depend`) so that a future application function that happens to share a name
is not silently exempt from the guard M3 spent three rounds establishing. Prove
it by adding a `public` function named after an allow-listed entry, with a
different signature, and asserting the test fails.

---

## Appendix — tool output

### `npx tsc --noEmit`

```
(exit 0, no output)
```

### `npm run lint`

```
✖ 19 problems (0 errors, 19 warnings)
```

All 19 are pre-existing `@typescript-eslint/no-unused-vars` warnings on
underscore-prefixed mock parameters in `tests/unit/f003-*`, `f004-*`, `f005-*`,
`f006-*`, `palette-actions-recents.test.tsx` and a `_phaseId` in an M1 test.
None are in files touched by M4.

### Test suite

Not run, by instruction: a worker is active and a full `vitest run` manufactures
auth rate-limit failures. Per-feature verification was done against the applied
catalog and source instead. Targeted suites reported green by their authors
(`f017-hours-migration`, `f018-budget-threshold-sweep`,
`f018-time-tracking-category-render`, `f019-hours-burndown-chart`,
`f020-metrics-snapshots-improvements-baseline-freeze`,
`metric-comparison-card`, `results-improvements`) were **not** independently
re-run; the criticisms above are of what those tests assert, not of whether they
pass.

### Live catalog probes (read-only, Management API)

```
select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relrowsecurity=false;
-> []

project_hours_client   prosecdef=t  search_path=public,pg_temp  acl={postgres,service_role,authenticated}  anon_exec=false
project_hours_team     prosecdef=t  search_path=public,pg_temp  acl={postgres,service_role,authenticated}  anon_exec=false
prevent_frozen_baseline_update  prosecdef=t  acl={postgres,service_role}  anon_exec=false  auth_exec=false
sweep_project_budget_thresholds prosecdef=t  acl={postgres,service_role}  anon_exec=false  auth_exec=false

cron.job jobid=4  'sweep-project-budget-thresholds'  '30 6 * * *'  active=true

projects_update_active_members (UPDATE)
  qual  = deleted_at IS NULL AND is_active_workspace_member(workspace_id)
  check = is_active_workspace_member(workspace_id)
  -- no role restriction; baseline_frozen_at guarded by no trigger  [B2.1]
```
