import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolveSitemapShareToken } from "@/lib/queries/sitemaps";
import { ArchitectureViewToggle } from "@/components/architecture/architecture-view-toggle";
import { ShareExportMenu } from "@/components/sitemap-tool/share-export-menu";
import type { ArchitectureActions } from "@/lib/architecture/actions-context";

// Phase 3 of the standalone Sitemap tool: the public, unauthenticated
// share route. This route group is deliberately OUTSIDE (workspace) and
// (portal) -- no layout.tsx here means no auth guard is inherited from
// either of those groups. resolveSitemapShareToken (lib/queries/sitemaps.ts)
// is the entire security boundary: it uses the admin client and validates
// the token itself, ignoring auth entirely.
//
// The board is rendered read-only via ArchitectureActionsProvider with
// readOnly: true and a set of no-op core actions -- readOnly hides every
// create/rename/delete/reorder affordance (see actions-context.tsx's
// header), so these functions are never actually invoked; they exist only
// to satisfy ArchitectureActions' required shape. No optional capability
// group (estimates, nodeMeta, clientVisibility, componentLinks) is
// supplied -- those are project-only concepts a standalone/public sitemap
// has no business exposing, and per the Phase 0 guarantee an absent
// capability group renders no affordance at all.
async function noop(): Promise<never> {
  throw new Error("This sitemap is read-only.");
}

const readOnlyActions: ArchitectureActions = {
  createSection: noop,
  deleteSection: noop,
  renameSection: noop,
  reorderSections: noop,
  moveSectionToPage: noop,
  changeSectionKind: noop,
  createPage: noop,
  changePageKind: noop,
  changePageSlug: noop,
  renamePage: noop,
  deletePage: noop,
  reorderPages: noop,
  importPages: noop,
  readOnly: true,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const result = await resolveSitemapShareToken(token);
  const name = result.ok && result.data ? result.data.name : "Sitemap";

  return {
    title: `${name} — Sitemap`,
    robots: { index: false, follow: false },
  };
}

export default async function SharedSitemapPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await resolveSitemapShareToken(token);

  if (!result.ok || !result.data) {
    notFound();
  }

  const { name, board } = result.data;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <div className="flex shrink-0 items-center gap-3">
          <ShareExportMenu pages={board.pages} sitemapName={name} />
          <span className="text-xs text-muted-foreground">Built with Goodguys Studio</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <ArchitectureViewToggle
          pages={board.pages}
          components={board.components}
          projectId={token}
          projectName={name}
          actions={readOnlyActions}
        />
      </div>
    </div>
  );
}
