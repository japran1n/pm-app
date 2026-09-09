import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, Clock3 } from "lucide-react";

import {
  getPortalProjects,
  getPortalOverview,
  getPortalActivitySummary,
} from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { ProjectProgress } from "@/components/portal/project-progress";
import { EmptyState } from "@/components/empty-state";
import { WorkspaceLogo } from "@/components/workspace/workspace-logo";
import { SignOutButton } from "@/components/portal/portal-sign-out-button";
import { countWaitingOnYouByProject } from "@/lib/portal/waiting-on-you-by-project";

function formatDate(iso: string): string {
  // Same fixed en-GB short form as project-progress.tsx, for the same
  // server/client hydration reason.
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// C4 / F003 (missions/20260903-portal, "Project scope"): the portal's
// project chooser. The prototype is project-first (a client works inside
// ONE project's sidebar, not a workspace-wide list), so this page is no
// longer the portal's default landing experience — it is a fallback for
// the two cases where there IS no single obvious project to land in:
// nothing shared yet (0 portal-enabled projects) or more than one. With
// exactly one, this page immediately hands off to that project's
// overview (`p/[projectId]/page.tsx`, the index route under the new
// per-project shell) rather than making every client click through a
// chooser of one.
//
// Redesign (2026-09-07, client feedback on the multi-project screenshot):
// most clients have exactly one project (handled by the redirect above),
// so this page only exists for the minority with several. It used to lead
// with a workspace-wide "Waiting on you" / "Delivered this week" task
// list and only then a row of small, mostly-identical project cards —
// exactly backwards for a screen whose only job is "which project do you
// want." The project cards are now the primary content (bigger, with a
// launch date and a per-project "N waiting on you" badge instead of a
// separate list), so picking a project needs one glance and one click,
// not cross-referencing a list against a card grid below it.
//
// This page keeps its own minimal header (brand, theme toggle, sign-out)
// because the outer layout no longer renders any chrome of its own (see
// that layout's comment) — the project-scoped sidebar shell
// (`p/[projectId]/layout.tsx`) is the only place that chrome now lives,
// and this page, having no project yet, isn't inside that shell.
export default async function PortalOverviewPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug, logo_url")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const projects = await getPortalProjects(workspace.id);

  // F003: exactly one portal-enabled project -> skip the chooser
  // entirely and land the client directly on that project's overview.
  if (projects.length === 1) {
    redirect(`/portal/${workspace.slug}/p/${projects[0].id}`);
  }

  const [overview, activity] = await Promise.all([
    getPortalOverview(workspace.id),
    // F2: only meaningful for a client session — the layout above already
    // guarantees anyone reaching this page is a client (canViewClientPortal
    // redirects everyone else), and `user` is guaranteed by that same
    // layout's own auth check, so this is safe to call unconditionally.
    user
      ? getPortalActivitySummary(workspace.id, user.id)
      : Promise.resolve(null),
  ]);

  // Multi-project chooser redesign: this page only ever renders once a
  // client has EITHER zero OR two-plus portal-enabled projects (see the
  // single-project redirect above), so its whole job here is "help a
  // client with several projects pick the right one," not "explain a
  // client's one project to them" — that explanation is the per-project
  // overview's job. Previously this page showed a full, workspace-wide
  // "Waiting on you" / "Delivered this week" task list ABOVE small project
  // cards; a client with several projects had to cross-reference each
  // list row's project-name tag back to a card below just to know where
  // to click, and the two cards' own "% complete" figures said nothing
  // about which project actually needed the client's attention right now.
  // The redesign leads with the cards (bigger, so the launch date/health
  // badge is legible at a glance) and folds "is anything waiting on me on
  // THIS project" into a single count badge per card instead — the same
  // fact, at the resolution this chooser screen actually needs. The full
  // task-level list still exists, scoped to one project, on that
  // project's own overview page (`p/[projectId]/page.tsx`).
  const waitingCountByProject = countWaitingOnYouByProject(
    overview.waitingOnYou,
  );

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <WorkspaceLogo
              workspaceId={workspace.id}
              name={workspace.name}
              logoUrl={workspace.logo_url}
              size="sm"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold tracking-tight">
                {workspace.name}
              </span>
              <span className="text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">Client portal</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SignOutButton workspaceSlug={workspaceSlug} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Your projects
          </h1>
          <p className="text-sm text-muted-foreground">
            Progress on the work {workspace.name} is delivering for you.
          </p>
        </div>

        {/* F2 (docs/client-dashboard-features-plan.md): a one-line summary
            above everything else, for a client who opens the portal
            infrequently and shouldn't have to hunt for what changed. `since
            === null` means this is their first-ever visit, where a "what
            changed" framing makes no sense — nothing renders in that case. */}
        {activity && activity.since && (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            Since your last visit ({formatDate(activity.since)}):{" "}
            <span className="font-medium text-foreground">
              {activity.completed.length}{" "}
              {activity.completed.length === 1 ? "task" : "tasks"} completed
            </span>
            {", "}
            <span className="font-medium text-foreground">
              {activity.added.length} new
            </span>
            {activity.commentCount > 0 && (
              <>
                {", "}
                <span className="font-medium text-foreground">
                  {activity.commentCount}{" "}
                  {activity.commentCount === 1 ? "comment" : "comments"}
                </span>{" "}
                from the team
              </>
            )}
            .
          </div>
        )}

        {projects.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing shared yet"
            description={`When ${workspace.name} shares a project with you, it will appear here.`}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {projects.map((project) => {
              const waitingCount = waitingCountByProject.get(project.id) ?? 0;
              return (
                <Link
                  key={project.id}
                  href={`/portal/${workspace.slug}/p/${project.id}`}
                  className="hover-lift flex flex-col gap-4 rounded-xl border border-border p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-xl font-semibold tracking-tight">
                        {project.name}
                      </span>
                      {project.description && (
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {project.description}
                        </span>
                      )}
                    </div>
                    {/* A single per-project signal instead of a duplicate
                        workspace-wide list — see the comment above this
                        section's data prep for why. */}
                    {waitingCount > 0 && (
                      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-600/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700">
                        <Clock3 aria-hidden className="size-3.5" />
                        {waitingCount} waiting on you
                      </span>
                    )}
                  </div>

                  {project.targetLaunchDate && (
                    <span className="text-xs text-muted-foreground">
                      Target launch: {formatDate(project.targetLaunchDate)}
                    </span>
                  )}

                  <ProjectProgress project={project} />
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
