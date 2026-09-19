import { notFound } from "next/navigation";

import { getPortalProjects } from "@/lib/queries/portal";
import { getClientVisibleStagingLinks } from "@/lib/queries/project-site";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { SitePreviewFrame } from "@/components/shared/site-preview-frame";
import { AlertTriangle } from "lucide-react";

// F06 (missions/20260919-staging-preview, SP-040, SP-041, SP-042, SP-043):
// the client-facing "Preview" view. Same workspace/project resolution
// pattern as the sibling `site/page.tsx` (resolve workspace by slug,
// `getPortalProjects`, `notFound()` if the project isn't in that list).
//
// SP-040: reads ONLY `getClientVisibleStagingLinks` -- never
// `getProjectStagingLinks` (the unfiltered, team-only sibling in
// lib/queries/project-site.ts). A `client_visible = false` staging/live
// link must never reach this payload.
//
// SP-042: `SitePreviewFrame` renders here WITHOUT `showVisibility` -- no
// visibility badge, no edit controls. That prop is `true` only on the
// team side (see the component's own JSDoc).
//
// SP-043: a hidden link does not exist on this page at all -- no count of
// hidden links, no "N more in preparation" copy, no `data-*` attribute
// carrying a hidden link's id or count. `getClientVisibleStagingLinks`
// already excludes them at the DB level, so there is nothing here to
// filter or hide a second time.
export default async function PortalStagingPage({
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

  const linksResult = await getClientVisibleStagingLinks(projectId);

  if (!linksResult.ok) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load your preview"
        description="Something went wrong loading this project's staging links. Try refreshing the page."
        testId="staging-view-error"
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <SitePreviewFrame links={linksResult.data} projectId={projectId} />
    </div>
  );
}
