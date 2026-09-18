"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { LayoutGrid, Loader2, Network, SlidersHorizontal } from "lucide-react";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { ArchitectureBoard } from "@/components/architecture/board";
import { getNodeDetailsForToggle } from "@/lib/actions/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";

// NX-006: CanvasBoard is the only consumer of @xyflow/react — statically
// importing it here pulled the whole flow-graph library into the shared
// bundle even for users who never open the canvas view. next/dynamic with
// `ssr: false` (the same pattern as dashboard-content-lazy.tsx) defers the
// xyflow chunk until the canvas view actually renders; the skeleton fills
// the same flex-1 slot so the toggle row doesn't jump while it loads.
const CanvasBoard = dynamic(
  () =>
    import("@/components/architecture/canvas-board").then(
      (mod) => mod.CanvasBoard,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-border bg-muted/30">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading canvas view</span>
      </div>
    ),
  },
);

type ViewMode = "board" | "canvas";

export function ArchitectureViewToggle({
  pages,
  components,
  projectId,
  projectName,
}: {
  pages: BoardPage[];
  components: BoardComponent[];
  projectId: string;
  projectName: string;
}) {
  const [view, setView] = useState<ViewMode>("canvas");

  // Details toggle — default OFF, persisted to localStorage per project.
  // Data fetched lazily on first enable, cached for the session.
  const storageKey = `pm-app:architecture-details:${projectId}`;
  const [showDetails, setShowDetails] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === 'true';
    } catch {
      return false;
    }
  });
  const [detailsData, setDetailsData] = useState<ArchitectureNodeDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Fetch once when toggle turns on, never again in this session.
  useEffect(() => {
    if (!showDetails || detailsData !== null) return;
    let cancelled = false;
    setDetailsLoading(true);
    getNodeDetailsForToggle(projectId).then(result => {
      if (cancelled) return;
      setDetailsLoading(false);
      if (result.ok) setDetailsData(result.data);
    });
    return () => { cancelled = true; };
  }, [showDetails, detailsData, projectId]);

  function toggleDetails() {
    const next = !showDetails;
    setShowDetails(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {}
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Toggle */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">
            Pages and sections here are the same records as tasks and subtasks
            in the List and Board task views -- edits made in one view show up
            in the other.
          </p>
          {/* Mission 20260914-portal-simplify, F011 (AS-020): tells the
              team where a client-visible section of this board actually
              surfaces in the portal -- "Site map" (F008's renamed portal
              nav item, formerly "Architecture"), reached from a
              section's own client-visibility toggle, not every page here
              (a page must be marked client-visible first). */}
          <p data-testid="architecture-client-visibility-note" className="text-xs text-muted-foreground">
            Shared pages appear to the client under Site map.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => setView("board")}
            title="Column view"
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
            onClick={() => setView("canvas")}
            title="Canvas view"
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              view === "canvas"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Network size={14} />
          </button>
          <div className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            onClick={toggleDetails}
            title={showDetails ? "Hide details" : "Show estimates & copy brief"}
            disabled={detailsLoading}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-50 ${
              showDetails
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {detailsLoading
              ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              : <SlidersHorizontal size={14} aria-hidden="true" />
            }
          </button>
        </div>
      </div>

      {view === "board" ? (
        <ArchitectureBoard
          pages={pages}
          components={components}
          projectId={projectId}
          showDetails={showDetails}
          detailsData={detailsData}
        />
      ) : (
        <CanvasBoard
          pages={pages}
          components={components}
          projectId={projectId}
          projectName={projectName}
          showDetails={showDetails}
          detailsData={detailsData}
        />
      )}
    </div>
  );
}
