import { redirect } from "next/navigation";
import { FileText } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getDocsInFolder } from "@/lib/queries/docs";
import { NewDocButton } from "@/components/docs/new-doc-button";
import { EmptyState } from "@/components/empty-state";

// W3 (docs/docs-system-plan.md): the workspace Docs "root" page — shown
// when no specific doc is open. Lists root-level docs (folderId === null);
// folders themselves are navigation-only in the sidebar, not previewed
// here. Empty state offers a "New document" CTA per the acceptance
// criteria ("Novi doc kreira se i browser navigira na editor").
export default async function DocsIndexPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

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

  const rootDocs = await getDocsInFolder(workspace.id, null, null);

  if (rootDocs.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Create your first document to start capturing notes and knowledge."
        action={<NewDocButton workspaceId={workspace.id} workspaceSlug={workspaceSlug} />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Docs</h1>
        <NewDocButton workspaceId={workspace.id} workspaceSlug={workspaceSlug} />
      </div>
      <ul className="flex flex-col gap-1">
        {rootDocs.map((doc) => (
          <li key={doc.id}>
            <a
              href={`/w/${workspaceSlug}/docs/${doc.id}`}
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
