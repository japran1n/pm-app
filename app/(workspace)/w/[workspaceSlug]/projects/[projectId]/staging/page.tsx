import { getProjectStagingLinks } from "@/lib/queries/project-site";
import { SitePreviewFrame } from "@/components/shared/site-preview-frame";

// F05 (SP-030..SP-034): workspace-side staging preview — the page a PM
// checks BEFORE a staging/live link is shared with the client.
//
// No auth gate here: the parent workspace layout
// (app/(workspace)/w/[workspaceSlug]/layout.tsx) already verified auth and
// active membership before this route is ever reached, and the project
// detail layout one level up (projects/[projectId]/layout.tsx, see its own
// header comment) already resolved/gated the project itself — this page
// only needs the project id it's handed via params.
//
// getProjectStagingLinks (lib/queries/project-site.ts, SP-001) is
// deliberately UNFILTERED by `client_visible` — unlike the portal's own
// sibling route (getClientVisibleStagingLinks). If we filtered by
// `client_visible` here, the team would have nowhere to review a staging
// link before deciding to share it with the client at all. The
// `showVisibility` badge on SitePreviewFrame is what makes that difference
// legible: a PM sees exactly which links the client can and cannot see,
// on the same screen, rather than that distinction being invisible.
export default async function ProjectStagingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;

  const links = await getProjectStagingLinks(projectId);

  // Failure-as-reassuring-fact pattern (see components/shared/
  // site-preview-frame.tsx and app/(portal)/.../site/page.tsx headers): a
  // query failure renders an explicit "couldn't load" state, never an
  // empty list — an empty list is itself meaningful (SP-033) and must not
  // be confused with a failed fetch.
  if (!links.ok) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Staging</h1>
          <p className="text-sm text-muted-foreground">
            Preview what the client sees on this project&apos;s staging and
            live links, including links not yet shared with the client.
          </p>
        </div>
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">
          Couldn&apos;t load staging links. Try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Staging</h1>
        <p className="text-sm text-muted-foreground">
          Preview what the client sees on this project&apos;s staging and
          live links, including links not yet shared with the client.
        </p>
      </div>

      {/* SP-033: still rendered when links.data is empty — SitePreviewFrame
          carries its own EmptyState, this tab never hides. */}
      <SitePreviewFrame links={links.data} projectId={projectId} showVisibility />
    </div>
  );
}
