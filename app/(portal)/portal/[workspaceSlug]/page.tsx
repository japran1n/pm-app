import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock3 } from "lucide-react";

import { getPortalProjects, getPortalOverview } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { ProjectProgress } from "@/components/portal/project-progress";
import { EmptyState } from "@/components/empty-state";

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

  const [projects, overview] = await Promise.all([
    getPortalProjects(workspace.id),
    getPortalOverview(workspace.id),
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

      {/* UX-22: the two questions a client actually opens the portal to
          answer — "is anything waiting on me?" and "what shipped
          recently?" — surfaced above the project grid instead of buried
          inside each project's own task list. */}
      {projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
            <div className="flex items-center gap-2">
              <Clock3
                aria-hidden="true"
                className="size-4 text-amber-600 dark:text-amber-400"
              />
              <h2 className="text-sm font-semibold">Waiting on you</h2>
            </div>
            {overview.waitingOnYou.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing waiting on you right now.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {overview.waitingOnYou.map((task) => (
                  <li key={task.id}>
                    <Link
                      href={`/portal/${workspace.slug}/t/${task.id}`}
                      className="hover-surface flex items-center justify-between gap-3 rounded-md px-2 py-1.5 -mx-2 text-sm"
                    >
                      <span className="min-w-0 truncate">{task.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {task.projectName}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
            <div className="flex items-center gap-2">
              <CheckCircle2
                aria-hidden="true"
                className="size-4 text-emerald-600 dark:text-emerald-400"
              />
              <h2 className="text-sm font-semibold">Delivered this week</h2>
            </div>
            {overview.deliveredThisWeek.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing delivered in the last 7 days.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {overview.deliveredThisWeek.map((task) => (
                  <li key={task.id}>
                    <Link
                      href={`/portal/${workspace.slug}/t/${task.id}`}
                      className="hover-surface flex items-center justify-between gap-3 rounded-md px-2 py-1.5 -mx-2 text-sm"
                    >
                      <span className="min-w-0 truncate">{task.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(task.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
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
