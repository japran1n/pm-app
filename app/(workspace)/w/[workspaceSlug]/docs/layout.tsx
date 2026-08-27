import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getDocFolders, getAllDocs } from "@/lib/queries/docs";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

// W3 (docs/docs-system-plan.md): two-column layout for the workspace-scoped
// docs area — a fixed-width folder/doc tree sidebar (DocsSidebar) plus
// whichever page (root list or a specific doc editor, W4) renders as
// `children`. Mirrors the "resolve workspace by slug, then fetch scoped
// data" pattern used by
// app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx.
//
// Relies on the workspace-membership guard one level up
// (app/(workspace)/w/[workspaceSlug]/layout.tsx) — reaching this layout at
// all already means the caller is an active member of this workspace.
export default async function DocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  const [folders, docs] = await Promise.all([
    getDocFolders(workspace.id, null),
    getAllDocs(workspace.id, null),
  ]);

  return (
    <div className="flex flex-1 gap-6 p-6 md:p-8">
      <aside className="flex w-full shrink-0 flex-col md:w-60">
        <DocsSidebar
          folders={folders}
          docs={docs}
          workspaceSlug={workspaceSlug}
          workspaceId={workspace.id}
        />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
