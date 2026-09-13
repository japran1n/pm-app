import { notFound } from "next/navigation";

import { getPortalFiles } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { FileText } from "lucide-react";
import { PortalFileList } from "@/components/portal/file-list";

// F3 (docs/client-dashboard-features-plan.md): every file shared on this
// project, one place, instead of a client having to remember which task a
// given attachment lives under.
//
// F003b (missions/20260903-portal): relocated here, under the
// project-scoped shell (`p/[projectId]/layout.tsx`), so it renders with
// the sidebar/topbar instead of the no-chrome page it used to be at
// `/portal/<slug>/files`. `p/[projectId]/layout.tsx` has already resolved
// and authorized `projectId` before this page ever runs, so nothing here
// needs to re-check it. The old URL now redirects here (see the route left
// behind at the old location).
//
// F001 (missions/20260914-portal-simplify, AS-001/AS-002): the query used
// to stay workspace-wide even after this page moved under a project-scoped
// URL, so a client on projects A and B viewing `p/A/files` saw attachments
// from every readable project -- including portal-disabled ones. `getPortal
// Files` is now given this route's own `projectId` and scopes (and gates on
// `portal_enabled`) accordingly.
export default async function PortalFilesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const files = await getPortalFiles(workspace.id, projectId);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground">
          Everything {workspace.name} has shared with you on this project.
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
