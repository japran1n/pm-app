"use client";

// Standalone Sitemap tool, Phase 2: the editor's client shell. Owns the
// top bar (back link, editable name, Share button) and hands the board
// itself off to the existing ArchitectureViewToggle, supplying this
// sitemap's own action set (sitemap-board-actions.ts) via its `actions`
// prop instead of the default project-backed wiring.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Share2 } from "lucide-react";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { ArchitectureViewToggle } from "@/components/architecture/architecture-view-toggle";
import { buildSitemapBoardActions } from "@/components/sitemap-tool/sitemap-board-actions";
import { SitemapShareDialog } from "@/components/sitemap-tool/sitemap-share-dialog";
import { RenameSitemapDialog } from "@/components/sitemap-tool/rename-sitemap-dialog";
import { Button } from "@/components/ui/button";

export function SitemapEditor({
  workspaceSlug,
  sitemapId,
  sitemapName,
  pages,
  components,
  initialShareToken,
}: {
  workspaceSlug: string;
  sitemapId: string;
  sitemapName: string;
  pages: BoardPage[];
  components: BoardComponent[];
  initialShareToken: string | null;
}) {
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const actions = useMemo(() => buildSitemapBoardActions(sitemapId), [sitemapId]);

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/w/${workspaceSlug}/tools/sitemap`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            aria-label="Back to sitemaps"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={() => setRenameOpen(true)}
            className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-muted/50"
          >
            <span className="truncate text-sm font-medium text-foreground">{sitemapName}</span>
            <Pencil
              className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
          </button>
        </div>
        <Button type="button" variant="outline" className="gap-1.5" onClick={() => setShareOpen(true)}>
          <Share2 className="size-4" aria-hidden="true" />
          Share
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <ArchitectureViewToggle
          pages={pages}
          components={components}
          projectId={sitemapId}
          projectName={sitemapName}
          actions={actions}
        />
      </div>

      <SitemapShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        sitemapId={sitemapId}
        initialToken={initialShareToken}
      />
      <RenameSitemapDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        sitemapId={sitemapId}
        initialName={sitemapName}
        onRenamed={() => router.refresh()}
      />
    </div>
  );
}
