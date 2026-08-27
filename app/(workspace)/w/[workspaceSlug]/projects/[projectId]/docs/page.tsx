import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/queries/projects";
import { getDocsInFolder } from "@/lib/queries/docs";
import { NewDocButton } from "@/components/docs/new-doc-button";

// W5 (docs/docs-system-plan.md): the project-scoped Docs tab's "root" page
// — shown when no specific doc is open, mirrors
// app/(workspace)/w/[workspaceSlug]/docs/page.tsx (W3) but scoped to this
// project's root-level docs (folderId === null, project_id === this
// project's id).
export default async function ProjectDocsIndexPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    redirect("/onboarding");
  }

  const project = await getProjectById(workspace.id, projectId);

  if (!project) {
    notFound();
  }

  const rootDocs = await getDocsInFolder(workspace.id, project.id, null);

  if (rootDocs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No documents in this project yet
        </p>
        <NewDocButton
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          projectId={project.id}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Docs</h1>
        <NewDocButton
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          projectId={project.id}
        />
      </div>
      <ul className="flex flex-col gap-1">
        {rootDocs.map((doc) => (
          <li key={doc.id}>
            <a
              href={`/w/${workspaceSlug}/projects/${project.id}/docs/${doc.id}`}
              className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              {doc.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
