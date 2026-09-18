"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LayoutGrid, Loader2, Network, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { ArchitectureBoard } from "@/components/architecture/board";
import { getNodeDetailsForToggle } from "@/lib/actions/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";
import { EstimateSummary } from "@/components/architecture/estimate-summary";

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
  // FIX (hydration mismatch): localStorage is not available during SSR, so
  // the initial render must match the server (false). We sync the real
  // persisted value in an effect once mounted on the client.
  const [showDetails, setShowDetails] = useState(false);
  const [detailsData, setDetailsData] = useState<ArchitectureNodeDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // FIX C-8: request id ref so a rapid toggle-off before the fetch resolves
  // never lets a stale response set loading/data state after the fact, and
  // toggling off always clears the loading flag immediately.
  const fetchIdRef = useRef(0);

  useEffect(() => {
    try {
      setShowDetails(localStorage.getItem(storageKey) === "true");
    } catch {
      // ignore — storage unavailable (private mode, SSR, etc.)
    }
    // Only run on mount / when the project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Fetch once when toggle turns on, never again in this session (until
  // detailsData is invalidated, e.g. after a write — see refreshDetails).
  useEffect(() => {
    if (!showDetails) {
      // FIX C-8: turning the toggle off must always release the button,
      // even if a fetch was in flight — otherwise a rapid on/off toggle
      // permanently disables it because the in-flight promise's
      // setDetailsLoading(false) never runs (its `cancelled` guard skips
      // it, and the fetch id changing below skips it again).
      fetchIdRef.current += 1;
      setDetailsLoading(false);
      return;
    }
    if (detailsData !== null) return;

    const fetchId = ++fetchIdRef.current;
    setDetailsLoading(true);

    getNodeDetailsForToggle(projectId)
      .then((result) => {
        if (fetchId !== fetchIdRef.current) return; // superseded/stale
        if (result.ok) {
          setDetailsData(result.data);
        } else {
          // FIX C-7: a failed server action used to be swallowed silently
          // -- the toggle just showed nothing. Surface the error and
          // revert the toggle so the button doesn't look "on" with no data.
          toast.error(result.error ?? "Failed to load details.");
          setShowDetails(false);
        }
      })
      .catch((err) => {
        if (fetchId !== fetchIdRef.current) return;
        toast.error(err instanceof Error ? err.message : "Failed to load details.");
        setShowDetails(false);
      })
      .finally(() => {
        if (fetchId === fetchIdRef.current) setDetailsLoading(false);
      });
  }, [showDetails, detailsData, projectId]);

  // NOTE (C-6, known limitation): detailsData is only invalidated by
  // toggling off/on. Write actions deep in the board tree (estimate saved
  // via DisciplineEstimatePopover, meta saved via NodeMetaDialog) call
  // router.refresh() for the server-rendered board data, but that doesn't
  // touch this client-side cache, so rollups can show stale numbers after
  // a save until the user toggles details off and back on. Fixing this
  // properly requires threading an onWriteSuccess callback (calling
  // setDetailsData(null) here) down through ArchitectureBoard/CanvasBoard
  // to estimate-chip.tsx's DisciplineEstimatePopover and node-meta-dialog.tsx
  // -- out of scope for this fix; see handoff for the follow-up spec.

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

      {showDetails && detailsData && (
        <EstimateSummary
          pages={pages}
          detailsData={detailsData}
        />
      )}

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
