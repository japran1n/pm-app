"use client";

// F113 (missions/20260903-portal, client-portal-phase-2-plan.md item B):
// one affordance per Pages table row that opens every client-visible
// link for that page (Figma frame, staging URL, live URL) -- "a row
// with three link icons is worse than a row with one affordance that
// opens them" per this feature's own spec. Reuses the existing
// DropdownMenu primitive (components/ui/dropdown-menu.tsx) rather than
// inventing a second popover pattern.

import { ExternalLink, Link2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PageLink, PageLinkKind } from "@/lib/queries/page-links";

const KIND_LABEL: Record<PageLinkKind, string> = {
  staging: "Staging",
  live: "Live site",
  figma: "Figma",
  sitemap: "Sitemap",
  drive: "Drive",
  webflow: "Webflow",
  gtm: "Tag manager",
  analytics: "Analytics",
  search_console: "Search console",
  other: "Other",
};

export function PageLinksMenu({ links }: { links: PageLink[] }) {
  if (links.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-micro text-muted-foreground hover-surface"
        data-testid="page-links-menu-trigger"
        aria-label="Open this page's links"
      >
        <Link2 className="size-3.5" aria-hidden="true" />
        Links
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="page-links-menu-content">
        {links.map((link) => (
          <DropdownMenuItem
            key={link.id}
            className="flex items-center justify-between gap-2"
            data-testid="page-links-menu-item"
            render={
              <a href={link.url} target="_blank" rel="noopener noreferrer" />
            }
          >
            {KIND_LABEL[link.kind]}
            <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
