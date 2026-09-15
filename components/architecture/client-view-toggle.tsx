"use client";

// 20260915-status-sitemap-audit, F2: the portal Site map's top-level
// client composition -- the read-only counterpart to
// `architecture-view-toggle.tsx`. Toggles between the existing flat
// column list (`ClientArchitectureBoard`, AS-091/AS-098) and the new
// read-only nested tree (`ClientSitemapTree`, AS-7), plus a trimmed
// Components panel (`ClientComponentPanel`, AS-9).
//
// Default view is "tree", mirroring the workspace board's own default
// (`architecture-view-toggle.tsx:45`) -- the audit's direct
// product-owner complaint was that clients only ever saw the weaker of
// the two views the team itself prefers (audit-sitemap.md, D.3).
//
// Named `ClientArchitectureBoardView` (not just `ClientViewToggle`) so
// this remains, in substance, "the client architecture board" that
// `app/(portal)/.../architecture/page.tsx` renders -- it composes
// `ClientArchitectureBoard` rather than replacing it.
import { useState } from "react";
import { LayoutGrid, Network } from "lucide-react";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { ClientArchitectureBoard } from "@/components/architecture/client-board";
import { ClientSitemapTree } from "@/components/architecture/client-sitemap-tree";
import { ClientComponentPanel } from "@/components/architecture/client-component-panel";

type ViewMode = "board" | "tree";

// AS-9's "appears on" navigation: both views mark their page's column/card
// root with `data-page-id` (client-page-column.tsx, client-sitemap-tree.tsx)
// -- neither view uses @xyflow/react, so a plain scrollIntoView works for
// either one, mirroring the workspace board's own `data-page-id` +
// scrollIntoView convention (board.tsx's `handlePageSelect`).
function scrollPageIntoView(pageId: string) {
  document
    .querySelector(`[data-page-id="${pageId}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

export function ClientArchitectureBoardView({
  pages,
  components,
}: {
  pages: BoardPage[];
  components: BoardComponent[];
}) {
  const [view, setView] = useState<ViewMode>("tree");
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-end gap-2 px-1">
        <button
          type="button"
          onClick={() => setPanelOpen((current) => !current)}
          aria-expanded={panelOpen}
          className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover hover:text-foreground transition-colors"
        >
          Components
        </button>
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => setView("board")}
            title="Column view"
            aria-pressed={view === "board"}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              view === "board"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            onClick={() => setView("tree")}
            title="Tree view"
            aria-pressed={view === "tree"}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              view === "tree"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Network size={14} />
          </button>
        </div>
      </div>

      {view === "board" ? (
        <ClientArchitectureBoard pages={pages} components={components} />
      ) : (
        <ClientSitemapTree pages={pages} />
      )}

      {panelOpen ? (
        <ClientComponentPanel
          components={components}
          pages={pages}
          selectedComponentId={selectedComponentId}
          onSelectComponent={(component) => setSelectedComponentId(component.id)}
          onPageSelect={(pageId) => scrollPageIntoView(pageId)}
          onClose={() => {
            setPanelOpen(false);
            setSelectedComponentId(null);
          }}
        />
      ) : null}
    </div>
  );
}
