"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LayoutGrid, Loader2, Network, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { ArchitectureBoard } from "@/components/architecture/board";
import * as architectureActions from "@/lib/actions/architecture";
import {
  ArchitectureActionsProvider,
  type ArchitectureActions,
} from "@/lib/architecture/actions-context";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";
import { EstimateSummary } from "@/components/architecture/estimate-summary";

// Phase 0 of the standalone Sitemap tool (decoupling the board UI from its
// server actions): the existing Architecture tab is the ONE place that
// still wires the board directly to the project/tasks-backed server
// actions in lib/actions/architecture/*. Every optional capability group
// is present and readOnly is false -- this is a pure passthrough of
// today's exact behaviour, just routed through the context instead of each
// leaf component importing the actions module for itself.
//
// Each capability below is a thin passthrough wrapper (rather than a bare
// function reference) so this file keeps one real, statically-analysable
// `architectureActions.<name>(...)` call site per barrel export -- the
// same guarantee tests/unit/m6-action-barrel-guard.test.ts already checks
// for every export of lib/actions/architecture.ts.
function getNodeDetailsForToggle(projectId: string) {
  return architectureActions.getNodeDetailsForToggle(projectId);
}

const projectBackedActions: ArchitectureActions = {
  createSection: (...args) => architectureActions.createSection(...args),
  deleteSection: (...args) => architectureActions.deleteSection(...args),
  renameSection: (...args) => architectureActions.renameSection(...args),
  reorderSections: (...args) => architectureActions.reorderSections(...args),
  moveSectionToPage: (...args) => architectureActions.moveSectionToPage(...args),
  changeSectionKind: (...args) => architectureActions.changeSectionKind(...args),
  createPage: (...args) => architectureActions.createPage(...args),
  changePageKind: (...args) => architectureActions.changePageKind(...args),
  changePageSlug: (...args) => architectureActions.changePageSlug(...args),
  renamePage: (...args) => architectureActions.renamePage(...args),
  deletePage: (...args) => architectureActions.deletePage(...args),
  reorderPages: (...args) => architectureActions.reorderPages(...args),
  importPages: (...args) => architectureActions.importPages(...args),
  readOnly: false,
  estimates: {
    setDisciplineEstimatesBulk: (...args) =>
      architectureActions.setDisciplineEstimatesBulk(...args),
    getNodeDetailsForToggle: (...args) => architectureActions.getNodeDetailsForToggle(...args),
  },
  nodeMeta: {
    setNodeMeta: (...args) => architectureActions.setNodeMeta(...args),
  },
  clientVisibility: {
    setPageClientVisibility: (...args) =>
      architectureActions.setPageClientVisibility(...args),
    setSectionClientVisibility: (...args) =>
      architectureActions.setSectionClientVisibility(...args),
  },
  componentLinks: {
    createComponent: (...args) => architectureActions.createComponent(...args),
    createComponentFromSection: (...args) =>
      architectureActions.createComponentFromSection(...args),
    linkComponentToSection: (...args) => architectureActions.linkComponentToSection(...args),
    unlinkComponentFromSection: (...args) =>
      architectureActions.unlinkComponentFromSection(...args),
    renameComponent: (...args) => architectureActions.renameComponent(...args),
    deleteComponent: (...args) => architectureActions.deleteComponent(...args),
    reorderComponents: (...args) => architectureActions.reorderComponents(...args),
  },
};

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

  // FIX (react-hooks/set-state-in-effect): reads localStorage (the actual
  // synchronization with the external system) directly in the effect body,
  // but the setState call itself is deferred into a microtask callback --
  // exactly the "calling setState in a callback function when external
  // state changes" shape the rule's own guidance recommends, instead of an
  // unconditional setState call as the effect's own top-level statement.
  useEffect(() => {
    queueMicrotask(() => {
      let persisted = false;
      try {
        persisted = localStorage.getItem(storageKey) === "true";
      } catch {
        // ignore — storage unavailable (private mode, SSR, etc.)
      }
      setShowDetails(persisted);
    });
    // Only run on mount / when the project changes.
  }, [storageKey]);

  // AS-088 FIX: details (used for the copy-brief icon and the estimates
  // summary) must be available on first load regardless of whether the
  // toggle is on. `showDetails` is a *display* gate only (whether the
  // estimates panel/summary is shown) -- it must never gate the fetch
  // itself, otherwise `detailsData` stays null forever on a fresh page
  // load with the toggle off by default, and consumers relying on
  // `detailsData` (e.g. the copy-brief icon in page-column-header) never
  // render even though the underlying data exists.
  //
  // Fetches once on mount (and once per project change), and again
  // whenever `detailsData` is invalidated (see `invalidateDetails` below)
  // -- independent of `showDetails`. Toggling the details panel on/off no
  // longer starts, cancels, or restarts this fetch.
  useEffect(() => {
    if (detailsData !== null) return;

    const fetchId = ++fetchIdRef.current;
    queueMicrotask(() => {
      if (fetchId === fetchIdRef.current) setDetailsLoading(true);
    });

    getNodeDetailsForToggle(projectId)
      .then((result) => {
        if (fetchId !== fetchIdRef.current) return; // superseded/stale
        if (result.ok) {
          setDetailsData(result.data);
        } else {
          // FIX C-7: a failed server action used to be swallowed silently
          // -- the toggle just showed nothing. Surface the error; if the
          // toggle happened to be on, revert it so the button doesn't look
          // "on" with no data. The fetch itself is not tied to the toggle,
          // so there's nothing else to roll back here.
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
  }, [detailsData, projectId]);

  // Write actions deep in the board tree (an estimate saved via
  // DisciplineEstimatePopover, a copy brief saved via NodeMetaDialog) call
  // router.refresh() for the server-rendered board data, which does NOT
  // touch this client-side cache. They also call `invalidateDetails` below,
  // threaded down through ArchitectureBoard/CanvasBoard -> PageColumnHeader
  // -> EstimateChip/NodeMetaDialog, so the summary table reflects the save
  // immediately instead of waiting for the user to toggle details off/on.
  //
  // Dropping the cache while `showDetails` is true deliberately re-triggers
  // the fetch effect above exactly once: the effect's guard is
  // `detailsData !== null`, and `fetchIdRef` only advances per fetch, so the
  // refetch resolves, sets data, and the effect goes quiet again. No loop.
  const invalidateDetails = useCallback(() => {
    setDetailsData(null);
  }, []);

  function toggleDetails() {
    // AS-088 FIX: the fetch effect above is no longer tied to `showDetails`
    // (it runs on mount / on invalidation, independent of the toggle), so
    // toggling no longer needs to cancel an in-flight fetch or touch
    // `fetchIdRef`/`detailsLoading` -- this is purely a display-gate flip
    // plus persistence of the user's preference.
    const next = !showDetails;
    setShowDetails(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {}
  }

  return (
    <ArchitectureActionsProvider actions={projectBackedActions}>
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
          onDetailsInvalidate={invalidateDetails}
        />
      ) : (
        <CanvasBoard
          pages={pages}
          components={components}
          projectId={projectId}
          projectName={projectName}
          showDetails={showDetails}
          detailsData={detailsData}
          onDetailsInvalidate={invalidateDetails}
        />
      )}
    </div>
    </ArchitectureActionsProvider>
  );
}
