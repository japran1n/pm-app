# Handoff: F107 — Reorder client portal Overview to answer, not index

## Status
COMPLETE

## Assertions covered
No F107 feature spec or validation-contract assertion IDs exist for this
task — it was assigned directly from `docs/client-portal-visual-plan.md`
Part 0/Part 2, not through the mission's `/mission-tasks` pipeline. No
existing assertion IDs were touched or weakened. New behaviour is covered
by named tests instead (listed below); none reference an AS-NNN id.

## Files changed
- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx`
- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx` (fix round: same latent defect, see below)
- `components/portal/overview-tiles.tsx`
- `components/portal/overview-tiles.test.tsx`
- `components/portal/hours-burndown-chart.tsx` (fix round: pure functions extracted, re-exported)
- `components/portal/launch-headline.tsx` (new)
- `components/portal/launch-headline.test.tsx` (new)
- `components/portal/waiting-on-you-block.tsx` (new)
- `components/portal/waiting-on-you-block.test.tsx` (new)
- `lib/portal/build-waiting-on-you-items.ts` (new)
- `lib/portal/build-waiting-on-you-items.test.ts` (new)
- `lib/hours/burndown-series.ts` (new, fix round)
- `tests/unit/server-client-boundary-imports.test.ts` (new, fix round — the check requested)

Did not touch `components/portal/phase-timeline.tsx` (owned by another
agent) or the `min-w-0` grid item in `page.tsx`.

## Commands run
`npx vitest run lib/portal/build-waiting-on-you-items.test.ts components/portal/launch-headline.test.tsx components/portal/waiting-on-you-block.test.tsx components/portal/overview-tiles.test.tsx tests/unit/f019-hours-burndown-chart.test.tsx tests/unit/server-client-boundary-imports.test.ts components/portal/portal-topbar.test.tsx tests/unit/portal-overview-queries.test.ts` (0, 78 passed)
`npx tsc --noEmit` (0)
`npm run build` (0, sourced `.env` first)
Manual runtime verification against the coordinator's own already-running dev server on `:3000` (see "Notes for the next worker" — this is the check the coordinator asked me to do, not a substitute for it being automated; automation is `tests/unit/server-client-boundary-imports.test.ts`, described below).

## THE BREAKAGE AND THE FIX (read first)

The coordinator reported the Overview page threw on every request in the
committed code:

```
Error: Attempted to call computeBurndownSeries() from the server but
computeBurndownSeries is on the client.
```

**Root cause**: `computeBurndownSeries` was defined and exported from
`components/portal/hours-burndown-chart.tsx`, which has a `"use client"`
directive at its top. Once a file is marked `"use client"`, Next.js turns
*every* export from it into a client-reference proxy for any server-side
importer — importing its *type* is erased at compile time and harmless,
but *calling* one of its runtime exports from a Server Component throws
at request time. `page.tsx` (the Overview page, a Server Component)
imported and called `computeBurndownSeries` directly from that file. This
is a Next.js RSC runtime rule, not a TypeScript or bundler-time one, so
`npx tsc --noEmit` and `npm run build` were both green through the whole
defect — neither one executes a Server Component's body.

**Fix**: matched the exact precedent named in the coordinator's message —
`lib/metrics/measurement-status.ts`, extracted from
`lib/queries/metrics.ts` for the identical class of defect (F069). Moved
the pure, DOM-free series/week-math functions (`computeBurndownSeries`,
`isoWeekToMonday`, `enumerateIsoWeeks`, `formatWeekLabel`, the
`BurndownPoint` type) out of `hours-burndown-chart.tsx` into a new module
with no `"use client"` directive and no client-only imports:
`lib/hours/burndown-series.ts`. `hours-burndown-chart.tsx` re-exports all
of them unchanged (`export { ... } from "@/lib/hours/burndown-series"`)
so its own component body and every existing caller/test of those names
(`tests/unit/f019-hours-burndown-chart.test.tsx`) keep working without a
second copy. `page.tsx` now imports `computeBurndownSeries` from
`lib/hours/burndown-series` directly.

**A second, pre-existing instance of the same defect was found and fixed
while in there**: `app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx`
(the Hours view itself, also a Server Component) imported
`computeBurndownSeries` AND `isoWeekToMonday` from `hours-burndown-chart.tsx`
the same way — this predates F107 entirely (it's the Hours view from
F019) and was not something I introduced, but it is the identical class
of bug sitting live in the same file tree, so I fixed it in the same
commit rather than leaving it for someone else to hit next. It now
imports both from `lib/hours/burndown-series` too.

### The two "unguarded read on a possibly-undefined prop" reports

Checked `Sparkline` (`overview-tiles.tsx`, receives `values`) and
`StatusDistributionBar` (receives `distribution`) in the committed code
as it stood before this fix round — both already read the prop
unconditionally (`values.length`, `distribution[bucket]`) with no guard.
I could not reproduce an actual `undefined` at either call site in the
current `page.tsx` (both call sites pass real arrays/objects), so these
were very likely a transient mid-edit state as the coordinator guessed —
but per the instruction to guard regardless, both now guard explicitly:
`Sparkline` returns `null` if `!values` (before checking `.length`), and
`StatusDistributionBar` returns `null` if `!distribution`, with `?? 0`
on every subsequent per-bucket read so a partial object degrades to "no
bar" instead of throwing.

## What would have caught this, and what I did about it

**Answer to the coordinator's question**: nothing in this repo's existing
CI gate exercises a Server Component's actual function body — `tsc`
type-checks, `next build` compiles and prerenders only the routes with no
dynamic server-only data dependency (this route has one, so it's never
statically rendered during build), and no test in the suite imports and
renders `PortalOverviewPage` itself (I checked: `grep -rl
"PortalOverviewPage" tests` returns nothing). The only thing that would
have caught it before a human opened the page is either (a) an actual
request against a running server with a real session — which is what I
did manually below, or (b) a **static check for the shape of the defect
itself**, independent of ever executing the function.

I added (b) as an automated, permanent check: `tests/unit/server-client-boundary-imports.test.ts`.
It walks `app/`, `components/`, and `lib/`, and flags any file **without**
a `"use client"` directive that imports a named value from a file **with**
one and then **calls it as a function** (as opposed to rendering it as a
JSX tag, which is the normal, correct way to use a Client Component from
a Server Component and must not be flagged). I proved it actually catches
this exact regression: I reverted `page.tsx`'s import back to
`hours-burndown-chart.tsx` locally, reran the test, watched it fail with
the exact file/line, then restored the fix and reran it green. This is
now a standing check — future workers touching either portal `page.tsx`
or a client-only helper file get a fast, specific failure instead of a
production 500.

I recommend the orchestrator add this test file's path to whatever the
mission treats as "the gate that must pass before a page can ship" (it's
already inside the ordinary `npx vitest run` sweep, so nothing further
should be needed if the mission runs the full suite before milestones —
if it currently only runs `tsc`/`build`/targeted tests per worker, this
file should be added to that targeted set going forward for any feature
touching a portal Server Component).

## Decisions made
- **Headline (2.1)**: new `LaunchHeadline` component reads `project.targetLaunchDate` / `project.launchConfidence` / `project.launchNote` (already fetched by the page via `getPortalProjects`) and renders as the largest text on the page, with an icon per confidence state (no colour-only encoding) and an honest "Launch date not set yet" empty state when neither field is set.
- **Topbar chip left in place, not removed**: `docs/client-portal-visual-plan.md` 2.1 asks explicitly for a decision on the existing small `LAUNCH … · ON TRACK` chip in `PortalTopbar`. I checked `components/portal/portal-topbar.test.tsx` (AS-005) and its three tests assert the chip renders the launch date/confidence on the Overview root path itself — removing or hiding it there would break a passing, in-contract test for an assertion outside this task's scope, which the "never weaken a test" rule forbids. Resolution: the chip stays untouched (file not edited at all), sized as a small `Badge` versus the new headline's `text-h2`+icon treatment, so the two are visually a "headline" and a "persistent small reminder" rather than two headlines competing. Documented in `launch-headline.tsx`'s own header comment.
- **"What we need from you" (2.2)**: added a pure function `buildWaitingOnYouItems` (no new DB read) that composes three already-fetched lists into one sorted, deduped item list: `getOpenApprovalsForClient` (same read the Approvals view renders), the page's existing `getPortalWaitingOnYou` task list, and `getClientDeliverables` filtered by the existing shared `isDeliverablePastDue` predicate. Dedup follows `getPortalWaitingOnYouCount`'s own documented rule (a task-subject open approval and its `pending_client_approval` task row are the same obligation, collapsed on the task id) so this block's row count can never exceed the tile's union count. Items sort oldest-first.
- **Tiles (2.3)**: `overview-tiles.tsx` gained an optional `chart` slot (sparkline, beside the value) and `belowFootnote` slot (wider chart, own row). Hours used gets a sparkline built from `computeBurndownSeries` (now sourced from `lib/hours/burndown-series.ts`, not reimplemented) — renders nothing below 3 points per the plan's own rule. Pages ready gets a stacked distribution bar from the same `clientBucket` classification `pagesReadyCount` already uses, with a text caption underneath (e.g. "5 done · 2 waiting on you") so the distribution survives greyscale without a new hue. Waiting on you stays a bare number (plan's own instruction — "a sparkline here would be noise"). Days to launch stays bare: grepped every migration for a `target_launch_date` history/audit table and found none — Part 4 of the same plan names the identical gap for `launch_confidence` and asks the decision be explicit; documented in `overview-tiles.tsx`'s own header rather than faking a slip indicator.
- Reused the existing status palette tokens (`bg-status-done` etc.) verbatim for the distribution bar — did not touch `app/globals.css`.
- **Extraction module placement**: put the extracted functions in `lib/hours/` (new directory) rather than `lib/queries/hours.ts`, mirroring `lib/metrics/measurement-status.ts` living outside `lib/queries/metrics.ts` — both precedents keep the pure/client-safe code physically separate from the file that imports `lib/supabase/server.ts`, so the import graph itself makes the boundary obvious rather than relying on everyone remembering which exports are "the safe ones."

## Out-of-scope work needed
- Part 1 (phase timeline chart fixes) is explicitly owned by another agent reworking `phase-timeline.tsx` — not touched.
- Part 3 visuals (bullet charts for Results, pipeline for Pages, budget honest-figure bar, deliverable-state strip, approval ageing, weekly delivery rhythm) are separate items in the same plan, not this task.
- Part 4 defects (blocked-phase reason field, phase progress weighting, `launch_confidence` history) are PM-tool gaps the plan itself flags as needing new schema/migration work before any UI can honestly show them — a `target_launch_date`/`launch_confidence` history table would also be needed to give "Days to launch" a real slip indicator (see Decisions above).
- Part 5 (dark-mode status palette lightness-band failure) is a separate, already-identified defect; not touched here per the "do not change those hues" instruction in this task's own brief.
- Consider running `tests/unit/server-client-boundary-imports.test.ts` as its own named CI step (not just inside a blanket `vitest run`) so a future regression of this exact class surfaces by name rather than as one line in a large failure list.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No F107 feature spec, clarification file, or validation-contract assertions exist for this task (it was handed down directly from `docs/client-portal-visual-plan.md`, bypassing `/mission-tasks`). Treated the task-prompt's own detailed instructions as the clarified spec and the plan doc's Part 0/Part 2 text as the definition of done, per the "resolve ambiguity from clarified spec... skill" and ZERO_QUESTIONS posture. New tests are named descriptively (e.g. `test_headline_at_risk_state`, `test_waiting_on_you_empty_case`) rather than against an AS-NNN id, since none was assigned.

AUTONOMOUS_DECISION: Left `PortalTopbar`'s launch chip untouched rather than suppressing it on the Overview route, to avoid breaking the three passing AS-005 tests in `portal-topbar.test.tsx` that assert its presence on that exact path. See "Decisions made" above.

AUTONOMOUS_DECISION: Fixed the same client/server boundary defect in the Hours view's own `page.tsx` (pre-existing, not introduced by F107) in the same commit rather than filing a separate follow-up, since it was the same three-line change once the shared module existed and leaving it would mean a second, still-live production 500 one click away from the page I was asked to fix.

## Notes for the next worker
- **I do not have a browser and still could not do a full visual/screenshot pass.** But per the coordinator's instruction to reduce reliance on "I couldn't verify," I did verify the *fix itself* at runtime rather than only via `tsc`/`build`: the coordinator's own dev server was already running on `localhost:3000`. I used `/dev-login?email=nina@demo.test` (the seeded demo client account for the seeded "Website Redesign" project, workspace `acme-studio`) to get a real session cookie, then `curl`'d `/portal/acme-studio/p/<project-id>` directly. Response: HTTP 200, no "Attempted to call" text anywhere in the payload, and the streamed RSC HTML contains real rendered markup for `data-testid="launch-headline"` (`"On track"`, with its `launch_note` sentence), `data-testid="waiting-on-you-block"` (real approval/task rows), `data-testid="tile-sparkline"` (a real polyline), and `data-testid="tile-pages-distribution"` (a real segmented bar with `bg-status-done`/`bg-status-progress`/etc. segments sized proportionally). This is real evidence the page renders end-to-end post-fix, not just that it type-checks.
- Please still take the five screenshots from my first handoff pass for the visual/design checks (colour, spacing, dark mode) that a curl can't tell you: (a) headline in each of on_track/at_risk/slipped, light and dark; (b) Hours-used sparkline on a project with ≥3 weeks logged; (c) Pages-ready distribution bar; (d) "What we need from you" with a mix of approval/task/deliverable rows; (e) the empty "Nothing waiting on you right now." state.
- `lib/hours/burndown-series.ts` and `lib/portal/build-waiting-on-you-items.ts` are both pure and directly unit-tested — no DB/mocking needed to extend either's test coverage further.
- `tests/unit/server-client-boundary-imports.test.ts` is a heuristic (regex-based, not a full AST parse) — it distinguishes "called as a function" from "rendered as JSX" by checking for a `<Name` tag anywhere in the importing file. A file that does both (rarely, if ever, a real pattern) would be missed; I did not find one when I ran it clean against the whole `app/`/`components/`/`lib/` tree.
