import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/queries/projects";
import { getDocFolders, getAllDocs } from "@/lib/queries/docs";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

// W5 (docs/docs-system-plan.md): project-scoped instance of the docs
// system's two-column layout — same pattern as the workspace-level
// app/(workspace)/w/[workspaceSlug]/docs/layout.tsx (W3), but the
// (workspaceId, projectId) scope is passed through to getDocFolders /
// getAllDocs instead of `null`, and DocsSidebar gets `projectId` so every
// link it renders (doc rows, new-doc/new-folder actions) stays inside this
// project's docs tree per lib/queries/docs.ts's applyScope contract.
//
// Relies on the project layout one level up
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx) for
// the workspace-membership guard and the projectId/workspaceId resolution
// + 404 handling (AS-039/AS-040) — this layout re-resolves both here only
// because a Next.js layout can't read data resolved by a parent layout.
export default async function ProjectDocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  const [folders, docs] = await Promise.all([
    getDocFolders(workspace.id, project.id),
    getAllDocs(workspace.id, project.id),
  ]);

  return (
    <div className="flex flex-1 gap-6 p-6 md:p-8">
      <aside className="flex w-full shrink-0 flex-col md:w-60">
        <DocsSidebar
          folders={folders}
          docs={docs}
          workspaceSlug={workspaceSlug}
          workspaceId={workspace.id}
          projectId={project.id}
        />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
