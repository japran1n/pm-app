import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getDocsInFolder } from "@/lib/queries/docs";
import { NewDocButton } from "@/components/docs/new-doc-button";

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
      <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">No documents yet.</p>
        <NewDocButton workspaceId={workspace.id} workspaceSlug={workspaceSlug} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Docs</h1>
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
