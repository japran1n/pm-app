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
  getProjectPhases,
} from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { OverviewTiles } from "@/components/portal/overview-tiles";
import { PhaseTimeline } from "@/components/portal/phase-timeline";
import { RiskBanner } from "@/components/portal/risk-banner";
import { LiveNow } from "@/components/portal/live-now";
import { TeamCard } from "@/components/portal/team-card";
import { PortalOverviewLive } from "@/components/portal/portal-overview-live";

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

  const [phasesResult, pages, waitingOnYouResult, risks, liveNow, team, overview, activity] =
    await Promise.all([
      getProjectPhases(project.id),
      getPortalPages(project.id),
      // F006f (missions/20260903-portal, AS-002): the tile below and the
      // "Waiting on you" list rendered under the phase timeline are fed
      // by this ONE project-scoped call -- see that function's own
      // comment for why the sidebar's Approvals badge (a different,
      // deliberately broader count across every approval_requests
      // subject type, not just tasks) stays on its own query.
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
    ]);

  const pagesReadyCount = pages.filter((page) => page.status.clientBucket === "done").length;
  const daysToLaunch = computeDaysToLaunch(project.targetLaunchDate, today);

  // AS-002: the tile's number and the list rendered beneath it are the
  // SAME array from the SAME project-scoped query -- one signal, one
  // place it's computed, never two independently-derived numbers that
  // could drift. `null` (not 0) on a failed read -- see OverviewTiles'
  // own prop comment for why 0 would be dishonest here.
  const waitingOnYouCount = waitingOnYouResult.ok ? waitingOnYouResult.data.length : null;
  // The Overview page's own "Waiting on you" list is this project's
  // rows only, never the workspace-wide set `overview.waitingOnYou`
  // carries (that field stays workspace-wide for the multi-project
  // chooser page, which has no per-project tile to disagree with) --
  // and empty on a failed read, paired with `waitingOnYouFailed` below
  // so the list renders an honest state instead of "nothing waiting".
  const projectScopedOverview = {
    waitingOnYou: waitingOnYouResult.ok ? waitingOnYouResult.data : [],
    deliveredThisWeek: overview.deliveredThisWeek,
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
      <RiskBanner risks={risks} />

      <OverviewTiles
        waitingOnYouCount={waitingOnYouCount}
        pagesReadyCount={pagesReadyCount}
        pagesTotalCount={pages.length}
        daysToLaunch={daysToLaunch}
        launchConfidence={project.launchConfidence}
      />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-8 lg:col-span-2">
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

          <div
            data-testid="rail-hours-placeholder"
            className="flex flex-col gap-2 rounded-lg border border-border p-5"
          >
            <span className="text-tag text-muted-foreground">Hours used</span>
            <span className="text-2xl font-semibold tracking-tight">—</span>
            <span className="text-xs text-muted-foreground">
              Available with the next release
            </span>
          </div>

          <TeamCard members={team} />
        </div>
      </div>
    </div>
  );
}
