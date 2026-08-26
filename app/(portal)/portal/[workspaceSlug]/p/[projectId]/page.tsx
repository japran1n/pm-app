import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { ProjectProgress } from "@/components/portal/project-progress";
import { PortalTaskList } from "@/components/portal/task-list";

// C4: one project, as the client sees it — progress, then the shared tasks
// grouped by where they stand.
//
// The project is resolved by filtering `getPortalProjects` rather than by a
// dedicated single-project query. That reuses one visibility path instead
// of two, and means a client who guesses another project's UUID gets the
// same `notFound()` as one that does not exist: RLS never returned the row,
// so there is nothing here to distinguish the two cases with.
export default async function PortalProjectPage({
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

  const projects = await getPortalProjects(workspace.id);
  const project = projects.find((p) => p.id === projectId);

  if (!project) notFound();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href={`/portal/${workspace.slug}`}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All projects
        </Link>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
          {project.description && (
            <p className="text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border p-5">
        <ProjectProgress project={project} />
      </div>

      <PortalTaskList project={project} workspaceSlug={workspace.slug} />
    </div>
  );
}
