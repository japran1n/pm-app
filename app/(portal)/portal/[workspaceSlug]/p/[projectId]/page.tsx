import { notFound } from "next/navigation";

import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { ProjectProgress } from "@/components/portal/project-progress";
import { PortalTaskList } from "@/components/portal/task-list";

// C4 / F003 (missions/20260903-portal, "Overview" -- AS-001's index
// route): one project, as the client sees it — progress, then the shared
// tasks grouped by where they stand. This is the SAME content the old
// `/portal/<slug>/p/<projectId>` page always rendered; F003's own spec
// ("Project scope") is explicit that this route must keep working by
// BEING the overview, not by being replaced with a stub — the
// prototype's fuller Overview (phase timeline, tiles, risk banner) is
// F006's scope, not this feature's, so this stays the real, working
// content it already was rather than a placeholder.
//
// The back-link to "All projects" and the page's own brand header are
// gone: both are now the surrounding shell's job
// (`p/[projectId]/layout.tsx`'s sidebar/topbar), not this page's.
//
// The project is resolved by filtering `getPortalProjects` rather than by
// a dedicated single-project query. That reuses one visibility path
// instead of two, and means a client who guesses another project's UUID
// gets the same `notFound()` as one that does not exist: RLS never
// returned the row, so there is nothing here to distinguish the two cases
// with. (The layout above this page resolves the very same project for
// the shell and would already have thrown notFound() first — this
// page's own lookup is what makes this route independently correct even
// if it is ever reached without that layout, e.g. in a future test that
// renders the page directly.)
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
      {project.description && (
        <p className="text-sm text-muted-foreground">{project.description}</p>
      )}

      <div className="rounded-lg border border-border p-5">
        <ProjectProgress project={project} />
      </div>

      <PortalTaskList project={project} workspaceSlug={workspace.slug} />
    </div>
  );
}
