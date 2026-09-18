import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getProjectById } from "@/lib/queries/projects";
import { getDocById, getDocLinks } from "@/lib/queries/docs";
import { getWorkspaceRoleForCurrentUser } from "@/lib/queries/portal";
import { MarkdownEditorLazy as MarkdownEditor } from "@/components/docs/markdown-editor-lazy";

export default async function ProjectDocEditorPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string; docId: string }>;
}) {
  const { workspaceSlug, projectId, docId } = await params;

  const { supabase, user } = await getCurrentUser();

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

  const doc = await getDocById(docId);

  if (!doc || doc.projectId !== projectId) {
    notFound();
  }

  const currentUserRole = await getWorkspaceRoleForCurrentUser(
    workspace.id,
    user.id,
  );

  // F114 (client-portal-phase-2-plan.md, items E-H): video/document link
  // previews only ever matter for a project-scoped doc (same reasoning
  // as DocClientVisibilityToggle's own comment) — this page is already
  // project-scoped, so it always fetches them.
  const docLinks = await getDocLinks(doc.id);

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href={`/w/${workspaceSlug}/projects/${project.id}/docs`}
          className="hover:text-foreground"
        >
          {project.name}
        </Link>
        <span>/</span>
        <Link
          href={`/w/${workspaceSlug}/projects/${project.id}/docs`}
          className="hover:text-foreground"
        >
          Docs
        </Link>
        <span>/</span>
        <span className="text-foreground">{doc.title}</span>
      </nav>

      <MarkdownEditor
        docId={doc.id}
        initialTitle={doc.title}
        initialContent={doc.content}
        initialUpdatedAt={doc.updatedAt}
        workspaceSlug={workspaceSlug}
        projectId={project.id}
        initialClientVisible={doc.clientVisible}
        initialDocKind={doc.docKind}
        initialRelevantFrom={doc.relevantFrom}
        initialDocLinks={docLinks}
        currentUserRole={
          (currentUserRole ?? undefined) as
            | "owner"
            | "admin"
            | "member"
            | "viewer"
            | "guest"
            | "client"
            | undefined
        }
      />
    </div>
  );
}
