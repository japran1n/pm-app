import { LayoutTemplate } from "lucide-react";

import { getArchitectureBoardForClient } from "@/lib/queries/architecture";
import { EmptyState } from "@/components/empty-state";
// ClientArchitectureBoard (components/architecture/client-board.tsx) is
// the flat column view; ClientArchitectureBoardView (F2,
// 20260915-status-sitemap-audit, AS-7/AS-9) composes it with the new
// read-only tree view and the trimmed Components panel, defaulting to the
// tree view like the workspace board's own default.
import { ClientArchitectureBoardView } from "@/components/architecture/client-view-toggle";

// Mission 20260910-182104, F037 (AS-091, AS-098): the portal's read-only
// Architecture route. Server Component, same access pattern every
// sibling view under this segment relies on (brief/page.tsx, pages/
// page.tsx): the enclosing `[projectId]/layout.tsx` already re-resolves
// the project via `getPortalProjects` (portal_enabled + client
// membership) and 404s otherwise -- no duplicate guard here.
//
// AS-098: `getArchitectureBoardForClient` (lib/queries/architecture.ts)
// is the client-filtered sibling of the team-side `getArchitectureBoard`
// -- it applies `client_visible = true` explicitly on top of RLS, so
// pages/sections the team hasn't marked client-visible never reach this
// route at all, not merely hidden by the UI.
export default async function PortalArchitecturePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;

  const result = await getArchitectureBoardForClient(projectId);
  const board = result.ok ? result.data : { pages: [], components: [] };

  if (board.pages.length === 0) {
    return (
      <EmptyState
        icon={LayoutTemplate}
        title="No pages yet"
        description="Once the team shares a page from this project, it will show up here."
        testId="architecture-view-empty"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ClientArchitectureBoardView pages={board.pages} components={board.components} />
    </div>
  );
}
