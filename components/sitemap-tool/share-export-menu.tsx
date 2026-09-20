"use client";

// Phase 4 of the standalone Sitemap tool: a small export affordance on the
// public share route's top bar. The share page already renders the full
// SitemapIoDialog (export tab only, since ArchitectureViewToggle is given
// readOnly actions) inside the canvas view's toolbar -- this menu is a
// quicker one-click path for the two most common formats without opening
// that dialog, using the same pure serialisers.

import { Download } from "lucide-react";

import type { BoardPage } from "@/lib/queries/architecture";
import { toJson, toCsv } from "@/lib/architecture/sitemap-io";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

function download(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ShareExportMenu({
  pages,
  sitemapName,
}: {
  pages: BoardPage[];
  sitemapName: string;
}) {
  const slug = (sitemapName || "sitemap").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            data-testid="share-export-menu-trigger"
          >
            <Download className="size-4" aria-hidden="true" />
            Export
          </Button>
        }
      />
      <DropdownMenuContent align="end" data-testid="share-export-menu-content">
        <DropdownMenuItem
          data-testid="share-export-json"
          onClick={() => download(`${slug}-sitemap.json`, toJson(pages), "application/json")}
        >
          JSON
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="share-export-csv"
          onClick={() => download(`${slug}-sitemap.csv`, toCsv(pages), "text/csv")}
        >
          CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
