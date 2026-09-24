import { notFound } from "next/navigation";
import { Network } from "lucide-react";

import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canReadSitemaps, canTeamWrite } from "@/lib/auth/permissions";
import { listSitemaps, listActiveSitemapShareTokens } from "@/lib/queries/sitemaps";
import { EmptyState } from "@/components/empty-state";
import { SitemapCard } from "@/components/sitemap-tool/sitemap-card";
import { NewSitemapDialog } from "@/components/sitemap-tool/new-sitemap-dialog";

// Standalone Sitemap tool, Phase 2: the instance list at
// /w/[workspaceSlug]/tools/sitemap. Server Component, same "no new
// auth/membership logic" pattern as every other tools/* page (see
// tools/webflow/page.tsx's own header comment) -- the workspace layout
// above this route already redirects unauthenticated visitors and 404s a
// non-member. `getWorkspaceContext` additionally resolves the workspace
// row itself (id, needed to scope listSitemaps), same helper the
// projects list page already uses.
export default async function SitemapListPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await getWorkspaceContext(workspaceSlug);

  // Sitemaps are team-readable incl. viewers (can_read_sitemap RLS);
  // guests and clients get a 404. Only writers see the create control and
  // share state (share rows are writer-only).
  if (!ctx.workspace || !ctx.role || !canReadSitemaps({ role: ctx.role })) {
    notFound();
  }
  const canEdit = canTeamWrite({ role: ctx.role });

  const sitemapsResult = await listSitemaps(ctx.workspace.id);
  const sitemaps = sitemapsResult.ok ? sitemapsResult.data : [];

  const sharesResult = canEdit
    ? await listActiveSitemapShareTokens(sitemaps.map((s) => s.id))
    : null;
  const shareTokenBySitemapId: Record<string, string> =
    sharesResult?.ok ? sharesResult.data : {};

  return (
    <div className="p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-foreground">Sitemaps</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan website structure and share with clients.
          </p>
        </div>
        {canEdit ? (
          <NewSitemapDialog workspaceId={ctx.workspace.id} workspaceSlug={workspaceSlug} />
        ) : null}
      </div>

      {sitemaps.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Network}
            title="No sitemaps yet"
            description="Create a sitemap to plan a site's structure and share it with a client."
          />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sitemaps.map((sitemap) => (
            <SitemapCard
              key={sitemap.id}
              workspaceSlug={workspaceSlug}
              sitemap={sitemap}
              shared={Boolean(shareTokenBySitemapId[sitemap.id])}
            />
          ))}
        </div>
      )}
    </div>
  );
}
