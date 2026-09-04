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
- `components/portal/overview-tiles.tsx`
- `components/portal/overview-tiles.test.tsx`
- `components/portal/launch-headline.tsx` (new)
- `components/portal/launch-headline.test.tsx` (new)
- `components/portal/waiting-on-you-block.tsx` (new)
- `components/portal/waiting-on-you-block.test.tsx` (new)
- `lib/portal/build-waiting-on-you-items.ts` (new)
- `lib/portal/build-waiting-on-you-items.test.ts` (new)

Did not touch `components/portal/phase-timeline.tsx` (owned by another
agent) or the `min-w-0` grid item in `page.tsx`.

## Commands run
`npx vitest run lib/portal/build-waiting-on-you-items.test.ts components/portal/launch-headline.test.tsx components/portal/waiting-on-you-block.test.tsx components/portal/overview-tiles.test.tsx` (0, 22 passed)
`npx vitest run components/portal/portal-topbar.test.tsx components/portal/status-label.test.ts tests/unit/portal-overview-queries.test.ts` (0, 60 passed — confirms the untouched topbar/status/overview-query surfaces still pass)
`npx tsc --noEmit` (0)
`npm run build` (0, sourced `.env` first)

## Decisions made
- **Headline (2.1)**: new `LaunchHeadline` component reads `project.targetLaunchDate` / `project.launchConfidence` / `project.launchNote` (already fetched by the page via `getPortalProjects`) and renders as the largest text on the page, with an icon per confidence state (no colour-only encoding) and an honest "Launch date not set yet" empty state when neither field is set.
- **Topbar chip left in place, not removed**: `docs/client-portal-visual-plan.md` 2.1 asks explicitly for a decision on the existing small `LAUNCH … · ON TRACK` chip in `PortalTopbar`. I checked `components/portal/portal-topbar.test.tsx` (AS-005) and its three tests assert the chip renders the launch date/confidence on the Overview root path itself — removing or hiding it there would break a passing, in-contract test for an assertion outside this task's scope, which the "never weaken a test" rule forbids. Resolution: the chip stays untouched (file not edited at all), sized as a small `Badge` versus the new headline's `text-h2`+icon treatment, so the two are visually a "headline" and a "persistent small reminder" rather than two headlines competing. Documented in `launch-headline.tsx`'s own header comment.
- **"What we need from you" (2.2)**: added a pure function `buildWaitingOnYouItems` (no new DB read) that composes three already-fetched lists into one sorted, deduped item list: `getOpenApprovalsForClient` (same read the Approvals view renders), the page's existing `getPortalWaitingOnYou` task list, and `getClientDeliverables` filtered by the existing shared `isDeliverablePastDue` predicate. Dedup follows `getPortalWaitingOnYouCount`'s own documented rule (a task-subject open approval and its `pending_client_approval` task row are the same obligation, collapsed on the task id) so this block's row count can never exceed the tile's union count. Items sort oldest-first.
- **Tiles (2.3)**: `overview-tiles.tsx` gained an optional `chart` slot (sparkline, beside the value) and `belowFootnote` slot (wider chart, own row). Hours used gets a sparkline built from `computeBurndownSeries` (reused from `hours-burndown-chart.tsx`, not reimplemented) — renders nothing below 3 points per the plan's own rule. Pages ready gets a stacked distribution bar from the same `clientBucket` classification `pagesReadyCount` already uses, with a text caption underneath (e.g. "5 done · 2 waiting on you") so the distribution survives greyscale without a new hue. Waiting on you stays a bare number (plan's own instruction — "a sparkline here would be noise"). Days to launch stays bare: grepped every migration for a `target_launch_date` history/audit table and found none — Part 4 of the same plan names the identical gap for `launch_confidence` and asks the decision be explicit; documented in `overview-tiles.tsx`'s own header rather than faking a slip indicator.
- Reused the existing status palette tokens (`bg-status-done` etc.) verbatim for the distribution bar — did not touch `app/globals.css`.

## Out-of-scope work needed
- Part 1 (phase timeline chart fixes) is explicitly owned by another agent reworking `phase-timeline.tsx` — not touched.
- Part 3 visuals (bullet charts for Results, pipeline for Pages, budget honest-figure bar, deliverable-state strip, approval ageing, weekly delivery rhythm) are separate items in the same plan, not this task.
- Part 4 defects (blocked-phase reason field, phase progress weighting, `launch_confidence` history) are PM-tool gaps the plan itself flags as needing new schema/migration work before any UI can honestly show them — a `target_launch_date`/`launch_confidence` history table would also be needed to give "Days to launch" a real slip indicator (see Decisions above).
- Part 5 (dark-mode status palette lightness-band failure) is a separate, already-identified defect; not touched here per the "do not change those hues" instruction in this task's own brief.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No F107 feature spec, clarification file, or validation-contract assertions exist for this task (it was handed down directly from `docs/client-portal-visual-plan.md`, bypassing `/mission-tasks`). Treated the task-prompt's own detailed instructions as the clarified spec and the plan doc's Part 0/Part 2 text as the definition of done, per the "resolve ambiguity from clarified spec... skill" and ZERO_QUESTIONS posture. New tests are named descriptively (e.g. `test_headline_at_risk_state`, `test_waiting_on_you_empty_case`) rather than against an AS-NNN id, since none was assigned.

AUTONOMOUS_DECISION: Left `PortalTopbar`'s launch chip untouched rather than suppressing it on the Overview route, to avoid breaking the three passing AS-005 tests in `portal-topbar.test.tsx` that assert its presence on that exact path. See "Decisions made" above.

## Notes for the next worker
- I do not have a browser in this session and could not visually verify the new layout. **Please screenshot the Overview page** (`/portal/<workspaceSlug>/p/<projectId>`) for a project with: (a) `launch_confidence` set to each of `on_track`/`at_risk`/`slipped` to check the headline's icon+colour+type-scale reads well in both light and dark mode; (b) a project with at least 3 weeks of billable hours logged to see the Hours-used sparkline; (c) a project with pages in more than one status bucket to see the Pages-ready distribution bar and its caption text; (d) a project with at least one open approval, one pending-approval task, and one past-due deliverable to see "What we need from you" render three distinct rows with correct aging text and links; (e) a project with nothing outstanding to confirm the empty state ("Nothing waiting on you right now.") renders instead of an empty block.
- `lib/portal/build-waiting-on-you-items.ts` is pure and directly unit-tested — no DB/mocking needed to extend its test coverage further.
- `components/portal/overview-tiles.tsx`'s new `Sparkline` and `StatusDistributionBar` are internal (not exported) since nothing else needs them yet; promote them to their own file if a future feature (e.g. Part 3's bullet charts) wants to share the primitive.
