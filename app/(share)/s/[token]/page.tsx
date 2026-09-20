import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolveSitemapShareToken } from "@/lib/queries/sitemaps";
import { SharedSitemapView } from "@/components/sitemap-tool/shared-sitemap-view";
import { ShareExportMenu } from "@/components/sitemap-tool/share-export-menu";

// Phase 3 of the standalone Sitemap tool: the public, unauthenticated
// share route. This route group is deliberately OUTSIDE (workspace) and
// (portal) -- no layout.tsx here means no auth guard is inherited from
// either of those groups. resolveSitemapShareToken (lib/queries/sitemaps.ts)
// is the entire security boundary: it uses the admin client and validates
// the token itself, ignoring auth entirely.
//
// No-op actions are NOT constructed here (Server Components cannot pass
// plain functions to Client Components in Next.js). Instead they live in
// SharedSitemapView ("use client"), which builds the readOnly actions
// object on the client boundary and wraps the canvas in the provider.

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
      <div className="flex min-h-0 flex-1 flex-col">
        <SharedSitemapView
          pages={board.pages}
          components={board.components}
          token={token}
          name={name}
        />
      </div>
    </div>
  );
}
