import Link from "next/link";
import { notFound } from "next/navigation";

import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { ProjectProgress } from "@/components/portal/project-progress";

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

  const projects = await getPortalProjects(workspace.id);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Your projects
        </h1>
        <p className="text-sm text-muted-foreground">
          Progress on the work {workspace.name} is delivering for you.
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">Nothing shared yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            When {workspace.name} shares a project with you, it will appear
            here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/portal/${workspace.slug}/p/${project.id}`}
              className="flex flex-col gap-4 rounded-lg border border-border p-5 transition-colors hover:border-foreground/30"
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
