# Handoff: F107 — Reorder client portal Overview to answer, not index

## Status
COMPLETE

## Assertions covered
No F107 feature spec or validation-contract assertion IDs exist for this
task — it was assigned directly from `docs/client-portal-visual-plan.md`
Part 0/Part 2, not through the mission's `/mission-tasks` pipeline.
AS-005 (`portal-topbar.test.tsx`) is the one EXISTING assertion this
round's fix touches — not weakened: still asserts the chip shows the
launch date/confidence, now on a route where no headline duplicates it,
plus a new explicit pair of tests for "hidden on Overview" / "shown
everywhere else." New behaviour is otherwise covered by named tests
(listed below); none reference an AS-NNN id.

## Files changed (across all four rounds of this task)
- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx`
- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx`
- `components/portal/overview-tiles.tsx` (round 4: grid className fix)
- `components/portal/overview-tiles.test.tsx` (round 4: new breakpoint test)
- `components/portal/hours-burndown-chart.tsx`
- `components/portal/portal-topbar.tsx` (round 3)
- `components/portal/portal-topbar.test.tsx` (round 3)
- `components/portal/waiting-on-you-block.tsx` (round 3: per-kind icons)
- `components/portal/waiting-on-you-block.test.tsx` (round 3)
- `components/portal/launch-headline.tsx`
- `components/portal/launch-headline.test.tsx`
- `lib/portal/build-waiting-on-you-items.ts`
- `lib/portal/build-waiting-on-you-items.test.ts`
- `lib/hours/burndown-series.ts`
- `tests/unit/server-client-boundary-imports.test.ts` (round 3: widened to catch property/member access, not just calls)

Did not touch `components/portal/phase-timeline.tsx` (owned by another
agent) or the `min-w-0` grid item in `page.tsx`.

## Commands run
`npx vitest run lib/portal/build-waiting-on-you-items.test.ts components/portal/launch-headline.test.tsx components/portal/waiting-on-you-block.test.tsx components/portal/overview-tiles.test.tsx tests/unit/f019-hours-burndown-chart.test.tsx tests/unit/server-client-boundary-imports.test.ts components/portal/portal-topbar.test.tsx tests/unit/portal-overview-queries.test.ts tests/unit/portal-waiting-on-you-count.test.ts` (0, 86 passed -- round 4 adds one test)
`npx tsc --noEmit` (0)
`npm run build` (0, sourced `.env` first)
Manual runtime re-verification against the coordinator's own running dev server on `:3000` (dev-login + curl) after round 3 AND after round 4 — see "Notes for the next worker."

## Round 4: the orphaned third tile

The coordinator measured all three round-3 fixes as correct and found one
new thing while checking the tile strip: `sm:grid-cols-2 lg:grid-cols-3`
put three tiles through a two-column tier between `sm` and `lg` --
`Pages ready`/`Hours used` side by side, `Days to launch` alone on its
own row with an empty half beside it.

**Chose three columns, not a fourth tile.** The coordinator set an
explicit bar for a fourth tile: it must answer something a client
currently cannot see on this page, not merely fill a hole. I checked the
two candidates the coordinator's own message named:
- "Billable vs. total hours" is already exactly what the Hours-used
  tile's own value + footnote states (`usedMinutes` "Of `soldMinutes`
  budgeted"). A second tile with the same fact would be the identical
  redundancy this feature's earlier rounds removed elsewhere.
- "Next dated milestone" is already visible on this same page, in the
  phase timeline directly below the tile strip (every phase's own date
  range). A tile repeating one phase's date is a smaller, less
  informative copy of a chart already on screen, not new information.

Nothing else read anywhere in this codebase's portal queries answers a
genuinely new client question on this specific page. Fixed the grid
instead: `overview-tiles.tsx`'s strip is now `grid-cols-1 sm:grid-cols-3`
-- one column below `sm`, three columns from `sm` up, with **no**
two-column class anywhere in between, so three tiles can never split
2-and-1 at any width. Added a test that asserts the className contains
`grid-cols-1` and `grid-cols-3` but never `grid-cols-2`.

## This round: three redundancies from the coordinator's live review

**1. Header chip duplicated the headline.** `PortalTopbar` now hides its
two launch `Badge`s specifically on the Overview route
(`pathname === basePath`, the exact same comparison
`resolvePortalStaticTitle`'s own first branch already makes — reused, not
reinvented) and keeps them on every other route. I did **not** conclude
the test intended the chip on every view including Overview — the
coordinator's framing was correct: AS-005 asserts the fact is visible
somewhere in the shell, not that this specific view must state it twice.
Updated `portal-topbar.test.tsx`'s three AS-005 tests to exercise a
non-Overview route (`/results`) instead of the shell root, and added two
new explicit tests: the chip is absent on Overview
(`test_AS_005_hides_the_launch_chips_on_the_overview_route`) and present
elsewhere (`test_AS_005_keeps_the_launch_chips_on_every_non_overview_route`).

**2. "Waiting on you" tile duplicated the block above it.** Removed the
tile entirely (three tiles remain: Pages ready, Hours used, Days to
launch) rather than inventing a fourth metric under a size constraint.
I looked for an honest replacement — an "on-time delivery rate" from
`task_activity` completion vs. due dates was the only candidate that
came close to a real client question the other three tiles don't already
answer — and concluded it's new aggregation work deserving its own
decision/spec, not something to slot in silently here. Named as
out-of-scope work below. The now-unused `getPortalWaitingOnYouCount` read
was removed from the Overview page's `Promise.all` (the function itself
is untouched — still exported, still has its own passing test file,
`tests/unit/portal-waiting-on-you-count.test.ts` — in case a future tile
or badge wants it again).

**3. All five block rows shared one icon.** `WaitingOnYouBlock` now maps
each `WaitingOnYouItemKind` to its own lucide icon: `approval` → `Stamp`
(a decision to make), `task` → `ClipboardCheck` (something to review
inside its own task page), `deliverable` → `PackageX` (something
overdue/missing). Icon still pairs with the row's own title/age/action
text — no colour-only (or icon-only) encoding.

## Verified with a live server, not just tsc/build

Same approach as the previous round, repeated after this round's changes
(the coordinator's dev server on `:3000`, `dev-login` + `curl` against
the seeded "Website Redesign" project as the seeded client `nina`):

- Overview route: HTTP 200, no error text. `tile-waiting-on-you` is
  **absent** from the tile strip (only `tile-pages-ready`,
  `tile-hours-used`, `tile-days-to-launch` render). `topbar-launch-chips`
  is **absent** from the page.
- Hours route (non-Overview): `topbar-launch-chips` **is present**.
- The five "What we need from you" rows render three distinct lucide
  icon classes in the raw HTML: `lucide-stamp` (approval),
  `lucide-clipboard-check` (task), `lucide-package-x` (deliverable).

## The boundary-test extension

Widened `tests/unit/server-client-boundary-imports.test.ts` per the
coordinator's specific ask: it previously only flagged a bare function
call (`Name(`) on a value imported from a `"use client"` module. It now
also flags property/member access (`Name.foo`) on the same import — the
other common way to use a client-only export as a runtime value outside
JSX (e.g. reading a constant object, calling a static method). A
compound JSX tag (`<Dialog.Trigger />`) is excluded from both checks by
treating `<Name` as JSX usage regardless of what follows, so a legitimate
compound-component render is never flagged for the member access its own
JSX performs. Ran it against the whole `app/`/`components/`/`lib/` tree
after the change — zero new violations, so this widening did not turn up
any false positives against real, legitimate code in this repo.

## Decisions made
(Carried over from prior rounds, plus this round's three above.)
- **Headline (2.1)**: `LaunchHeadline` reads `project.targetLaunchDate` / `project.launchConfidence` / `project.launchNote`, renders as the largest text on the page, icon per confidence state, honest empty state.
- **"What we need from you" (2.2)**: `buildWaitingOnYouItems` composes three already-fetched reads (`getOpenApprovalsForClient`, the page's existing `getPortalWaitingOnYou`, `getClientDeliverables` filtered by `isDeliverablePastDue`) into one deduped, oldest-first list — no new query.
- **Tiles (2.3)**: Hours used carries a sparkline from `computeBurndownSeries` (now in `lib/hours/burndown-series.ts`); Pages ready carries a stacked distribution bar from the existing `clientBucket` classification; Days to launch stays bare (no `target_launch_date` history exists in this schema — grepped every migration).
- **Client/server boundary fix**: extracted `computeBurndownSeries` and its week-math helpers out of `"use client"` `hours-burndown-chart.tsx` into directive-free `lib/hours/burndown-series.ts`, matching the `lib/metrics/measurement-status.ts` (F069) precedent exactly. Fixed the identical pre-existing defect in the Hours view's own `page.tsx` in the same commit.

## Out-of-scope work needed
- A genuine fourth Overview tile (e.g. "on-time delivery rate" from `task_activity` completion vs. due dates) is a real candidate now that "Waiting on you" is gone, but needs its own decision/spec (what "on time" means, whether it's a rate or a count, what the honest empty state is) rather than being invented under this task's own size constraint.
- Part 1 (phase timeline chart fixes) is explicitly owned by another agent reworking `phase-timeline.tsx` — not touched.
- Part 3 visuals (bullet charts for Results, pipeline for Pages, budget honest-figure bar, deliverable-state strip, approval ageing, weekly delivery rhythm) are separate items in the same plan, not this task.
- Part 4 defects (blocked-phase reason field, phase progress weighting, `launch_confidence`/`target_launch_date` history) are PM-tool gaps the plan itself flags as needing new schema/migration work.
- Part 5 (dark-mode status palette lightness-band failure) is a separate, already-identified defect; not touched here per the "do not change those hues" instruction.
- Consider running `tests/unit/server-client-boundary-imports.test.ts` as its own named CI step so a future regression of this exact class surfaces by name.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Hid the topbar's launch chips on the Overview route specifically (not globally) rather than leaving them everywhere or removing them everywhere, per the coordinator's explicit instruction and reasoning about AS-005's actual scope. Updated the three existing AS-005 tests to a non-Overview route and added two new tests locking in the route-conditional behaviour, rather than leaving the old assertion silently describing behaviour that no longer holds on Overview.

AUTONOMOUS_DECISION: Dropped to three Overview tiles rather than inventing a fourth metric, since no existing read on the page answers a new client question the way Hours/Pages/Launch already do — a real fourth tile is named as out-of-scope work needing its own decision, not fabricated here.

AUTONOMOUS_DECISION: Chose `Stamp`/`ClipboardCheck`/`PackageX` (lucide-react) for approval/task/deliverable respectively — picked for semantic fit (a stamp for a decision, a clipboard-check for a task to review, a package-x for something missing/overdue) rather than any existing precedent in this codebase, since no prior UI in this repo distinguishes these three obligation types by icon.

## Notes for the next worker
- All three round-3 items (chip, icons, tile removal) were independently confirmed by the coordinator's own browser measurement — no further check needed on those specifically.
- **Round 4 needs a mobile-breakpoint check**, per the coordinator's own request: the tile strip is now `grid-cols-1` below `sm` (640px) and `grid-cols-3` from `sm` up, with no two-column tier in between. Please measure at a phone width (< 640px, should stack to one column, tiles full-width) and at a narrow tablet/small-laptop width just above 640px (should already be three columns, not two) — the exact failure mode being checked for is "does any width show two tiles on one row with a third orphaned below," which should now be structurally impossible since `grid-cols-2` does not appear anywhere in the strip's className.
- I don't have a browser but did verify all three fixes at the raw-HTML level via the coordinator's own running dev server (see "Verified with a live server" above) — real confirmation of presence/absence, not a substitute for actually looking at layout/spacing/colour.
- `tests/unit/server-client-boundary-imports.test.ts` is still a heuristic (regex, not full AST) — it now also flags property access, but a destructuring import used as a runtime value in some other exotic non-call, non-member-access, non-JSX shape (e.g. spread into an object, passed as a bare identifier to a non-JSX function argument where the callee itself renders it as JSX internally) would still be missed. I did not find such a case in this repo when I ran the widened check clean against the whole `app/`/`components/`/`lib/` tree.
