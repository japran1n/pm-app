import { notFound } from "next/navigation";

import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { getSitemapById, getSitemapBoard, getActiveSitemapShareToken } from "@/lib/queries/sitemaps";
import { SitemapEditor } from "@/components/sitemap-tool/sitemap-editor";

// Standalone Sitemap tool, Phase 2: the editor route at
// /w/[workspaceSlug]/tools/sitemap/[sitemapId]. Server Component shell --
// resolves the sitemap + board data, then hands off to <SitemapEditor>
// (Client Component) for the interactive top bar + ArchitectureViewToggle.
// No new auth/membership logic (inherits the workspace layout guard, same
// as every sibling tools/* page); a sitemap id that doesn't resolve to a
// row in THIS workspace (wrong workspace, or someone else's id entirely)
// 404s exactly like a project id that doesn't belong to the workspace
// does elsewhere in this codebase -- RLS already prevents cross-workspace
// reads from returning a row at all, this is the belt-and-suspenders
// explicit check.
export default async function SitemapEditorPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; sitemapId: string }>;
}) {
  const { workspaceSlug, sitemapId } = await params;
  const ctx = await getWorkspaceContext(workspaceSlug);

  if (!ctx.workspace) {
    notFound();
  }

  const sitemapResult = await getSitemapById(sitemapId);
  if (
    !sitemapResult.ok ||
    !sitemapResult.data ||
    sitemapResult.data.archivedAt !== null ||
    sitemapResult.data.workspaceId !== ctx.workspace.id
  ) {
    notFound();
  }

  const sitemap = sitemapResult.data;

  const boardResult = await getSitemapBoard(sitemapId);
  const board = boardResult.ok ? boardResult.data : { pages: [], components: [] };

  const shareTokenResult = await getActiveSitemapShareToken(sitemapId);
  const shareToken = shareTokenResult.ok ? shareTokenResult.data : null;

  return (
    <SitemapEditor
      workspaceSlug={workspaceSlug}
      sitemapId={sitemap.id}
      sitemapName={sitemap.name}
      pages={board.pages}
      components={board.components}
      initialShareToken={shareToken}
    />
  );
}
