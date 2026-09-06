import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

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
// F008 (AS-018, AS-019, AS-020, AS-024): the only two regions on this page
// that need to update live -- see that component's own header comment for
// why the rest of the page stays a plain server-rendered RSC.
import { PortalOverviewLive } from "@/components/portal/portal-overview-live";

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
              <span className="text-tag text-muted-foreground">Client portal</span>
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

        {/* UX-22: the two questions a client actually opens the portal to
            answer — "is anything waiting on me?" and "what shipped
            recently?" — surfaced above the project grid instead of buried
            inside each project's own task list. */}
        {projects.length > 0 && (
          <PortalOverviewLive
            workspaceId={workspace.id}
            workspaceSlug={workspace.slug}
            initialOverview={overview}
          />
        )}

        {projects.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing shared yet"
            description={`When ${workspace.name} shares a project with you, it will appear here.`}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/portal/${workspace.slug}/p/${project.id}`}
                className="hover-lift flex flex-col gap-4 rounded-lg border border-border p-5"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{project.name}</span>
                  {project.description && (
                    <span className="line-clamp-2 text-sm text-muted-foreground">
                      {project.description}
                    </span>
                  )}
                </div>

                <ProjectProgress project={project} />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
