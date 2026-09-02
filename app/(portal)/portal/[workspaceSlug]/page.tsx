import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import {
  getPortalProjects,
  getPortalOverview,
  getPortalActivitySummary,
} from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { ProjectProgress } from "@/components/portal/project-progress";
import { EmptyState } from "@/components/empty-state";
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

// C4: the portal's landing page — one card per project the client has been
// given access to, each showing how much of the shared work is done, what
// is due next, and whether anything is late.
//
// The progress figure counts only tasks the team marked client_visible,
// because those are the only rows RLS returns here. That is a deliberate
// definition, not a limitation: a client's "80% done" should describe the
// work they were told about, not a percentage silently computed over
// internal tasks they cannot see and cannot ask about.
export default async function PortalOverviewPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [projects, overview, activity] = await Promise.all([
    getPortalProjects(workspace.id),
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
    <div className="flex flex-col gap-10">
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
    </div>
  );
}
