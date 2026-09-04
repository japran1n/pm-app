import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/queries/projects";
import { getDocById } from "@/lib/queries/docs";
import { MarkdownEditor } from "@/components/docs/markdown-editor";

export default async function ProjectDocEditorPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string; docId: string }>;
}) {
  const { workspaceSlug, projectId, docId } = await params;

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

  const doc = await getDocById(docId);

  if (!doc || doc.projectId !== projectId) {
    notFound();
  }

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
        workspaceSlug={workspaceSlug}
        projectId={project.id}
        initialClientVisible={doc.clientVisible}
        initialDocKind={doc.docKind}
      />
    </div>
  );
}
