import { notFound } from "next/navigation";

import { getPortalFiles } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { FileText } from "lucide-react";
import { PortalFileList } from "@/components/portal/file-list";

// F3 (docs/client-dashboard-features-plan.md): every file shared across
// every project, one place, instead of a client having to remember which
// task a given attachment lives under.
//
// F003b (missions/20260903-portal): relocated here, under the
// project-scoped shell (`p/[projectId]/layout.tsx`), so it renders with
// the sidebar/topbar instead of the no-chrome page it used to be at
// `/portal/<slug>/files`. `p/[projectId]/layout.tsx` has already resolved
// and authorized `projectId` before this page ever runs, so nothing here
// needs to re-check it. The query stays workspace-wide, unchanged from
// before this move -- per this feature's own "keep queries and RLS
// assumptions exactly" instruction -- so this remains every file shared
// across every project, not just the one named in the URL; `projectId`
// only selects which project's shell wraps the page. The old URL now
// redirects here (see the route left behind at the old location).
export default async function PortalFilesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const files = await getPortalFiles(workspace.id);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground">
          Everything {workspace.name} has shared with you, across every
          project.
        </p>
      </div>

      {files.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No files yet"
          description="Files attached to tasks shared with you will show up here."
        />
      ) : (
        <PortalFileList workspaceSlug={workspace.slug} files={files} />
      )}
    </div>
  );
}
