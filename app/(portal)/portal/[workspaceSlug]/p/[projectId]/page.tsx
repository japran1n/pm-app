import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, MessageSquare, Plus } from "lucide-react";

import {
  getPortalActivitySummary,
  getPortalLiveNow,
  getPortalOverview,
  getPortalPages,
  getPortalProjects,
  getPortalRisks,
  getPortalTeam,
  getPortalWaitingOnYou,
  getPortalWeeklyDelivery,
  getProjectPhases,
} from "@/lib/queries/portal";
import { getProjectCurrentBudgetPeriod, getProjectHoursClient } from "@/lib/queries/hours";
import { getOpenApprovalsForClient } from "@/lib/queries/approvals";
import { getClientDeliverables } from "@/lib/queries/deliverables";
import { getClientVisiblePortalAccounts } from "@/lib/queries/project-site";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { OverviewTiles } from "@/components/portal/overview-tiles";
import { BudgetBar } from "@/components/portal/budget-bar";
import { PhaseTimeline } from "@/components/portal/phase-timeline";
import { RiskBanner } from "@/components/portal/risk-banner";
import { LiveNow } from "@/components/portal/live-now";
import { TeamCard } from "@/components/portal/team-card";
import { PortalOverviewLive } from "@/components/portal/portal-overview-live";
import { WeeklyDeliveryChart } from "@/components/portal/weekly-delivery-chart";
import { LaunchHeadline } from "@/components/portal/launch-headline";
import { WaitingOnYouBlock } from "@/components/portal/waiting-on-you-block";
import { buildWaitingOnYouItems } from "@/lib/portal/build-waiting-on-you-items";
import { buildNextFromYouAnswer } from "@/lib/portal/build-next-from-you";
import { computeBurndownSeries } from "@/lib/hours/burndown-series";
import type { ClientBucket } from "@/components/portal/status-label";

// F006 (missions/20260903-portal, AS-002, AS-003, AS-010, AS-031): the
// prototype's own Overview -- a risk banner slot, four tiles, the phase
// timeline, the waiting-on-you strip, "since your last visit" as a row
// list, and a right rail with live-now, an hours placeholder and the
// team card. This is the SAME route F003 left rendering its own,
// simpler "progress bar + shared task list" content ("F006 is the
// feature that rebuilds this into the prototype's fuller Overview" --
// F003's own handoff) -- that content is fully replaced here, not
// extended.
//
// The project is resolved by filtering `getPortalProjects` rather than a
// dedicated single-project query, matching the exact pattern the layout
// above this page (and the pre-F006 version of this same page) already
// used -- one visibility path, not two, and this route stays
// independently correct even if it's ever reached without that layout.
// F085 (missions/20260903-portal audit, defect 1): same wide fallback
// window F019's own Hours page (hours/page.tsx) uses when a project has
// no budget period at all -- see that file's own header for why
// `sold_minutes` still stays `null` either way.
const WIDE_FROM = "2000-01-01";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  // Same fixed en-GB short form used elsewhere in this file's siblings
  // (project-progress.tsx, portal-overview-live.tsx), for the same
  // server/client hydration reason.
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function computeDaysToLaunch(targetLaunchDate: string | null, today: string): number | null {
  if (!targetLaunchDate) return null;
  const target = new Date(`${targetLaunchDate}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((target - now) / (24 * 60 * 60 * 1000));
}

export default async function PortalOverviewPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const projects = await getPortalProjects(workspace.id);
  const project = projects.find((p) => p.id === projectId);

  if (!project) notFound();

  const today = todayIso();

  const [
    phasesResult,
    pages,
    waitingOnYouResult,
    risks,
    liveNow,
    team,
    overview,
    activity,
    currentPeriod,
    openApprovalsResult,
    deliverablesResult,
    accountsResult,
    weeklyDeliveryResult,
    warrantyRow,
  ] = await Promise.all([
    getProjectPhases(project.id),
    getPortalPages(project.id),
    // F006f (missions/20260903-portal, AS-002): the "Waiting on you" list
    // rendered under the phase timeline is fed by this ONE project-scoped
    // call -- see that function's own comment for why the sidebar's
    // Approvals badge (a different, deliberately broader count across
    // every approval_requests subject type, not just tasks) stays on its
    // own query.
    //
    // F107 round 2 (missions/20260903-portal, coordinator review): the
    // separate `getPortalWaitingOnYouCount` union read that used to feed
    // the now-removed "Waiting on you" TILE is gone -- `WaitingOnYouBlock`
    // below is built from THIS list plus `openApprovalsResult`/
    // `deliverablesResult` (already fetched for the block), and restating
    // the same rows as a bare count directly beneath their own named list
    // was the exact duplication the coordinator's review named.
    getPortalWaitingOnYou(project.id, project.name),
    getPortalRisks(project.id),
    getPortalLiveNow(project.id),
    getPortalTeam(project.id),
    getPortalOverview(workspace.id),
    // Only meaningful for a client session -- the layout above already
    // guarantees anyone reaching this page is a client, and `user` is
    // guaranteed by that same layout's own auth check, so this is safe
    // to call unconditionally. Same pattern the pre-F003 workspace-root
    // page already used.
    user ? getPortalActivitySummary(workspace.id, user.id) : Promise.resolve(null),
    // F085 (defect 1): the current budget period, same read F019's own
    // Hours page uses -- see this file's own WIDE_FROM comment.
    getProjectCurrentBudgetPeriod(project.id),
    // F107 (missions/20260903-portal, docs/client-portal-visual-plan.md
    // 2.2): the exact read the Approvals view itself renders -- reused
    // here to build "What we need from you", never a second query for
    // the same rows. See `buildWaitingOnYouItems`'s own header for why
    // no fourth path exists.
    getOpenApprovalsForClient(project.id),
    // F107 (2.2): the exact read the Your list view renders -- reused
    // here (filtered to past-due) for the same reason.
    getClientDeliverables(project.id),
    // Package C: accounts the client owns but hasn't provisioned yet are
    // their own "waiting on you" obligation -- same client-visible read
    // the "Your site" accounts table renders, reused here rather than a
    // second query. See `buildWaitingOnYouItems`'s own header.
    getClientVisiblePortalAccounts(project.id),
    // F111 (missions/20260903-portal, docs/client-portal-visual-plan.md
    // 3.6): the weekly delivery rhythm's own read -- see
    // lib/queries/portal.ts's own header on getPortalWeeklyDelivery for
    // the two reads (tasks, task_activity) this needs and why.
    getPortalWeeklyDelivery(project.id, project.startDate, today),
    // F115 round 2 (coordinator review, docs/client-portal-phase-2-plan.md
    // C): case 4's warranty-window fallback and the headline's own
    // "Launched"/"Launching" tense both need `warranty_until` -- not
    // carried by `getPortalProjects`' `PortalProject` shape (no other
    // caller on THIS page needs it), so this reads it directly, same
    // pattern the "Your site" launch-day card already uses
    // (site/page.tsx's own identical comment). RLS already scopes this
    // SELECT the same as every other read on this page.
    supabase.from("projects").select("warranty_until").eq("id", project.id).maybeSingle(),
  ]);

  // F085 (defect 1): usedMinutes/soldMinutes come from the SAME RPC
  // (`project_hours_client`) F019's Hours page reads, scoped to the same
  // current budget period -- one source, never a guessed number. `null`
  // usedMinutes means no budget and nothing logged at all (both the
  // weekly series and sold_minutes are empty), the honest "-" case.
  const hoursSummary = await getProjectHoursClient(
    project.id,
    currentPeriod?.periodStart ?? WIDE_FROM,
    currentPeriod?.periodEnd ?? today,
  );
  const hasAnyHoursData = hoursSummary.weekly.length > 0 || hoursSummary.soldMinutes !== null;
  const usedMinutes = hasAnyHoursData
    ? (hoursSummary.weekly[hoursSummary.weekly.length - 1]?.cumulativeMinutes ??
      hoursSummary.weekly.reduce((sum, week) => sum + week.minutes, 0))
    : null;

  const pagesReadyCount = pages.filter((page) => page.status.clientBucket === "done").length;
  const daysToLaunch = computeDaysToLaunch(project.targetLaunchDate, today);

  // F107 (missions/20260903-portal, docs/client-portal-visual-plan.md
  // 2.3): the Pages ready tile's distribution bar -- the SAME
  // `clientBucket` every page here already carries (`pagesReadyCount`
  // above is itself one slice of this same count), never a second
  // classification.
  const pagesStatusDistribution = pages.reduce(
    (acc, page) => {
      acc[page.status.clientBucket] += 1;
      return acc;
    },
    { waiting: 0, progress: 0, blocked: 0, done: 0 } as Record<ClientBucket, number>,
  );

  // F107 (2.3): the Hours used tile's sparkline -- the SAME cumulative
  // series `computeBurndownSeries` builds for the Hours view's own
  // burn-down chart (hours-burndown-chart.tsx), never a second query.
  const usedMinutesSeries = computeBurndownSeries(
    hoursSummary.weekly,
    hoursSummary.soldMinutes,
    today,
  ).map((point) => point.usedMinutes);

  // F107 (2.2): "What we need from you" -- built from the three reads
  // above (open approvals, the project-scoped pending-approval task
  // list already fetched for the list under the phase timeline, and
  // past-due deliverables), never a fourth path to the same data. A
  // failed approvals or deliverables read degrades to an empty list for
  // that source rather than failing the whole page -- the tile above
  // already carries the honest "we couldn't load this" state for the
  // union count; this block just may show fewer rows than that count
  // implies until the read succeeds again.
  const waitingOnYouItems = buildWaitingOnYouItems({
    approvals: openApprovalsResult.ok ? openApprovalsResult.data : [],
    tasks: waitingOnYouResult.ok ? waitingOnYouResult.data : [],
    deliverables: deliverablesResult.ok ? deliverablesResult.data : [],
    accounts: accountsResult.ok ? accountsResult.data : [],
    workspaceSlug: workspace.slug,
    projectId: project.id,
    todayIso: today,
  });

  // F115 (missions/20260903-portal, docs/client-portal-phase-2-plan.md
  // C): "what happens next" -- reuses the SAME open-approvals,
  // deliverables and phases reads already fetched above (for
  // `waitingOnYouItems` and the phase timeline), never a fourth query.
  // A failed read degrades to an empty list for that source, same
  // posture as `waitingOnYouItems` above.
  const warrantyUntil = warrantyRow.data?.warranty_until ?? null;

  const nextFromYou = buildNextFromYouAnswer({
    approvals: openApprovalsResult.ok ? openApprovalsResult.data : [],
    deliverables: deliverablesResult.ok ? deliverablesResult.data : [],
    phases: phasesResult.ok ? phasesResult.data : [],
    todayIso: today,
    warrantyUntil,
  });

  // F085 (missions/20260903-portal audit, defect 2): the TILE no longer
  // reads `waitingOnYouResult.data.length` -- it reads the deliberately
  // broader `getPortalWaitingOnYouCount` union above. The list rendered
  // beneath it stays this project-scoped task list, unchanged.
  // The Overview page's own "Waiting on you" list is this project's
  // rows only, never the workspace-wide set `overview.waitingOnYou`
  // carries (that field stays workspace-wide for the multi-project
  // chooser page, which has no per-project tile to disagree with) --
  // and empty on a failed read, paired with `waitingOnYouFailed` below
  // so the list renders an honest state instead of "nothing waiting".
  // F009 (missions/20260903-portal): `overview.deliveredThisWeek` is
  // `getPortalOverview(workspace.id)`'s workspace-wide list -- every
  // portal-enabled project's delivered rows, not just this one. Filtering
  // it down to `project.id` here closes the exact leak this feature's own
  // amendment named ("PortalOverviewLive ... is workspace-wide today ...
  // its strip can surface another project's rows"): the initial render is
  // scoped the same way `projectId` below scopes every live Realtime
  // event this component admits after mount.
  const projectScopedOverview = {
    waitingOnYou: waitingOnYouResult.ok ? waitingOnYouResult.data : [],
    deliveredThisWeek: overview.deliveredThisWeek.filter(
      (task) => task.projectId === project.id,
    ),
  };

  // `activity.since === null` means this is the client's first-ever
  // visit -- a "here's what changed" framing makes no sense with no
  // prior visit to compare against, so nothing renders in that case,
  // matching the pre-F006 workspace-root page's identical guard.
  const hasActivity =
    activity?.since &&
    (activity.completed.length > 0 || activity.added.length > 0 || activity.commentCount > 0);

  return (
    <div className="flex flex-col gap-8">
      {/* F107 (missions/20260903-portal, docs/client-portal-visual-plan.md
          2.1): "are we on track?" and "when, and how sure?" answered
          first, largest, before anything else on the page -- the same
          `launchConfidence`/`targetLaunchDate`/`launchNote` the topbar's
          own small chip and the Your-site launch day card already read
          (see this component's own header for why the topbar chip stays
          rather than being deleted). */}
      <LaunchHeadline
        targetLaunchDate={project.targetLaunchDate}
        launchConfidence={project.launchConfidence}
        launchNote={project.launchNote}
        nextFromYou={nextFromYou}
        today={today}
      />

      <RiskBanner
        risks={risks}
        yourListHref={`/portal/${workspace.slug}/p/${project.id}/your-list`}
      />

      {/* F107 (2.2): "what do you need from me?" answered second, as a
          named, actionable block -- not buried inside the tile strip
          below. */}
      <WaitingOnYouBlock items={waitingOnYouItems} />

      <OverviewTiles
        pagesReadyCount={pagesReadyCount}
        pagesTotalCount={pages.length}
        pagesStatusDistribution={pagesStatusDistribution}
        usedMinutes={usedMinutes}
        usedMinutesSeries={usedMinutesSeries}
        soldMinutes={hoursSummary.soldMinutes}
        hoursHref={`/portal/${workspace.slug}/p/${project.id}/hours`}
        daysToLaunch={daysToLaunch}
        launchConfidence={project.launchConfidence}
        // Paket D (billing_model gating follow-up): time/hours are never
        // shown to a `fixed_price` client anywhere in the portal -- the
        // Hours tile is the same leak `BudgetBar` below was flagged for,
        // gated the same way.
        showHoursTile={project.billingModel === "hourly"}
      />

      {/* F108 (missions/20260903-portal, docs/client-portal-visual-plan.md
          3.3): the one-glance budget figure — its own full-width block,
          not squeezed inside the "Hours used" tile above. The tile's
          column is a third of the page width at `lg`, which is not
          enough room to plot the ceiling mark and, on the over-budget
          path, the overage segment PAST it, both legibly labelled — the
          burn-down chart on the Hours view already earns its own full
          card for the identical reason. `usedMinutes`/`soldMinutes` are
          the exact same numbers the tile above already reads, never a
          second query. */}
      {/* Paket D (billing_model gating follow-up): `BudgetBar` is entirely
          hours-denominated (used/sold minutes, no non-hour data) -- a
          `fixed_price` project omits it outright rather than rendering a
          version of it, since there is no budget-in-money figure this
          component tracks that would need to survive the gate. */}
      {project.billingModel === "hourly" && (
        <BudgetBar usedMinutes={usedMinutes} soldMinutes={hoursSummary.soldMinutes} />
      )}

      {/* F111 (missions/20260903-portal, docs/client-portal-visual-plan.md
          3.6): placed here, immediately after the budget bar and before
          the phase-by-phase grid below, rather than at the very bottom of
          the page (the plan's own "3.6" ordering is a section number, not
          a layout instruction -- see this feature's own handoff for why
          the bottom isn't assumed correct just because it's last in the
          plan). This is the second full-width, single-scale, one-glance
          figure on the page after the budget bar -- both answer "and is
          that good?" without a click, before the client drops into the
          phase-level detail in the grid below. It is proof of PAST
          motion (evidence, not a claim) that pairs with the phase
          timeline's proof of CURRENT motion right beneath it, rather than
          competing with the tiles above (which are current-state numbers,
          not history) for the same slot. */}
      {weeklyDeliveryResult.ok ? (
        <WeeklyDeliveryChart weeks={weeklyDeliveryResult.data} />
      ) : (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load delivery history"
          description="Something went wrong loading this project's weekly delivery chart. Try refreshing the page."
          testId="weekly-delivery-chart-error"
        />
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* F104 round 3: `min-w-0` -- a CSS grid item's default
            min-width is `auto`, so without this the PhaseTimeline's
            internally-scrolling SVG could size THIS track wider than
            the viewport instead of scrolling inside its own container,
            pushing the whole page into a sideways scroll (coordinator
            measurement: body.scrollWidth 952 vs clientWidth 808 while
            the chart's own scroller fit exactly). */}
        <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
          {phasesResult.ok ? (
            <PhaseTimeline phases={phasesResult.data} today={today} />
          ) : (
            // AS-011: a failed `project_statuses`/`tasks` read used to
            // silently compute 0% for every phase from an empty map --
            // this renders an honest "we could not load this" instead,
            // never a percentage the function itself doesn't have.
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load project phases"
              description="Something went wrong loading this project's timeline. Try refreshing the page."
              testId="phase-timeline-error"
            />
          )}

          <PortalOverviewLive
            workspaceId={workspace.id}
            workspaceSlug={workspace.slug}
            initialOverview={projectScopedOverview}
            waitingOnYouFailed={!waitingOnYouResult.ok}
            projectId={project.id}
          />

          {hasActivity && activity && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Since your last visit</h2>
                {activity.since && (
                  <span className="text-xs text-muted-foreground">
                    {formatDate(activity.since)}
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-1">
                {activity.completed.map((task) => (
                  <li key={`completed-${task.id}`}>
                    <Link
                      href={`/portal/${workspace.slug}/p/${task.projectId}/t/${task.id}`}
                      className="hover-surface -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <CheckCircle2
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-status-done"
                        />
                        <span className="min-w-0 truncate">{task.title}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">Completed</span>
                    </Link>
                  </li>
                ))}
                {activity.added.map((task) => (
                  <li key={`added-${task.id}`}>
                    <Link
                      href={`/portal/${workspace.slug}/p/${task.projectId}/t/${task.id}`}
                      className="hover-surface -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Plus
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-status-progress"
                        />
                        <span className="min-w-0 truncate">{task.title}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">Added</span>
                    </Link>
                  </li>
                ))}
                {activity.commentCount > 0 && (
                  <li className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                    <MessageSquare aria-hidden="true" className="size-3.5 shrink-0" />
                    {activity.commentCount}{" "}
                    {activity.commentCount === 1 ? "comment" : "comments"} from the team
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <LiveNow entries={liveNow} />

          {/* F085 (missions/20260903-portal audit, defect 1): this rail
              used to duplicate the "Hours used" tile above with its own
              hard-coded "Available with the next release" placeholder --
              a second, contradicting dead tile on the same screen, one
              click from the fully working Hours view (F019). The tile
              above is now wired to the real read; this rail's own copy
              is deleted rather than duplicated, per this feature's own
              "wire both to the real query, or delete them" instruction. */}

          <TeamCard members={team} workspaceSlug={workspace.slug} projectId={project.id} />
        </div>
      </div>
    </div>
  );
}
