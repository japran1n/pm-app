"use client";

// Octopus.do-style sitemap canvas for the Architecture tab.
//
// Unlike the column board (board.tsx) this view is NOT free-form: node
// positions are computed by lib/architecture/page-tree.ts's tidy tree
// layout and the connecting lines are derived from the hierarchy, never
// drawn by hand. Hierarchy itself comes from `page_slug` path segments
// (see that module's header for why there is no parent_page_id), so
// "move a page in the tree" is "rewrite its slug", and the canvas stays
// a projection of real data rather than a second source of truth.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useReactFlow,
  ViewportPortal,
  ReactFlowProvider,
  PanOnScrollMode,
  type Node,
  type NodeProps,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronUp, FolderClosed, Plus, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import {
  buildPageTree,
  layoutPageTree,
  pruneCollapsed,
  buildConnectors,
  treeBounds,
  DEFAULT_LAYOUT,
  type LaidOutNode,
} from "@/lib/architecture/page-tree";
import { CreatePageDialog } from "@/components/architecture/create-page-dialog";
import { AddSectionButton } from "@/components/architecture/add-section-button";
import { PageColumnHeader } from "@/components/architecture/page-column-header";
import { PageKindSelector } from "@/components/architecture/page-kind-selector";
import { DeletePageButton } from "@/components/architecture/delete-page-button";
import { SectionCard } from "@/components/architecture/section-card";
import { ComponentPanel } from "@/components/architecture/component-panel";
import { useComponentHover } from "@/lib/architecture/use-component-hover";
import { SitemapIoDialog } from "@/components/architecture/sitemap-io-dialog";
import { EstimateChip } from "@/components/architecture/estimate-chip";
import { computeRollups } from "@/lib/architecture/estimate-rollup";
import type {
  ArchitectureNodeDetails,
  DisciplineEstimate,
  EstimateRollup,
} from "@/lib/architecture/types";

type NodeActions = {
  onAddChild: (parentSlug: string) => void;
  onToggleCollapse: (key: string) => void;
  onCreateAtPath: (path: string) => void;
  onComponentClick: (componentId: string) => void;
  onMeasure: (key: string, height: number) => void;
};

type SitemapNodeData = {
  node: LaidOutNode;
  actions: NodeActions;
  components: BoardComponent[];
  showDetails?: boolean;
  estimates?: DisciplineEstimate[];
  detailsData?: ArchitectureNodeDetails | null;
};

// Colour carries the node's nature at a glance, reusing the design
// system's existing Architecture tokens: --cms is Webflow's CMS lilac,
// --component its component green, --folder the amber added alongside
// them for pure grouping nodes.
function nodeAccent(node: LaidOutNode): string {
  if (node.page === null) return "folder";
  const kind = node.page.pageKind;
  return kind === "cms" || kind === "cms_template" ? "cms" : "";
}

function SitemapNode({ data }: NodeProps) {
  const { node, actions, components, showDetails, detailsData } = data as SitemapNodeData;
  const page = node.page;
  const isFolder = page === null;
  const accent = nodeAccent(node);

  // The layout needs the card's real height -- estimating it from the
  // section count runs short whenever a title wraps, and a short estimate
  // makes this card overlap the row below it.
  const cardRef = useRef<HTMLDivElement>(null);
  const { onMeasure } = actions;
  const nodeKey = node.key;
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => {
      onMeasure(nodeKey, card.offsetHeight);
    });
    observer.observe(card);
    onMeasure(nodeKey, card.offsetHeight);
    return () => observer.disconnect();
  }, [nodeKey, onMeasure]);

  return (
    <div
      ref={cardRef}
      className={cn(
        "rounded-lg border bg-card shadow-xs transition-colors",
        accent === "folder" &&
          "border-dashed border-folder-border bg-folder/5 hover:border-folder-border-hover",
        accent === "cms" && "border-cms-border bg-cms/5 hover:border-cms-border-hover",
        accent === "" && "border-border hover:border-border-control-hover",
      )}
      style={{ width: DEFAULT_LAYOUT.nodeWidth }}
    >
      {isFolder ? (
        <>
          <div className="flex items-center gap-1.5 border-b border-folder-border px-2.5 py-2">
            <FolderClosed className="size-3.5 shrink-0 text-folder-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-folder-foreground">
              {node.label}
            </span>
          </div>
          <div className="flex flex-col items-start gap-1 px-2.5 py-2">
            <p className="font-mono text-[10px] text-muted-foreground">/{node.key}</p>
            {/* A folder is a path segment with no page of its own. Giving
                it a real page is the only way to "fill" it, so offer that
                directly rather than leaving the node inert. */}
            <button
              type="button"
              onClick={() => actions.onCreateAtPath(node.key)}
              className="nodrag nopan text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Create page here
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            className={cn(
              "flex items-center gap-1 border-b px-1.5 py-1",
              accent === "cms" ? "border-cms-border" : "border-border",
            )}
          >
            <div className="nodrag nopan min-w-0 flex-1">
              <PageColumnHeader page={page} />
            </div>
            <div className="nodrag nopan flex shrink-0 items-center gap-0.5">
              <PageKindSelector taskId={page.id} kind={page.pageKind} />
              <DeletePageButton page={page} />
            </div>
          </div>
          <div className="nodrag nopan flex flex-col gap-1 p-1.5">
            {page.sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                components={components}
                onComponentClick={actions.onComponentClick}
              />
            ))}
            <AddSectionButton pageTaskId={page.id} />
          </div>
        </>
      )}

      {/* Collapsed branches keep a badge with the hidden child count so a
          folded subtree is never invisible, only compact. */}
      {(node.hiddenChildren ?? 0) > 0 ? (
        <button
          type="button"
          onClick={() => actions.onToggleCollapse(node.key)}
          aria-label={`Expand ${node.hiddenChildren} pages under ${node.label}`}
          className="nodrag absolute -bottom-2.5 left-1/2 z-10 flex h-5 -translate-x-1/2 items-center gap-0.5 rounded-full border border-primary/40 bg-card px-1.5 font-mono text-[10px] text-primary transition-colors hover:bg-primary/10"
        >
          <ChevronDown className="size-3" aria-hidden />
          {node.hiddenChildren}
        </button>
      ) : (
        <div className="nodrag nopan absolute -bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1">
          {node.children.length > 0 && (
            <button
              type="button"
              onClick={() => actions.onToggleCollapse(node.key)}
              aria-label={`Collapse pages under ${node.label}`}
              className="nodrag flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              <ChevronUp className="size-3" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => actions.onAddChild(node.key)}
            aria-label={`Add child page under ${node.label}`}
            className="nodrag flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="size-3" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { sitemap: SitemapNode };

function SitemapCanvas({
  pages,
  components,
  projectId,
  projectName,
  showDetails = false,
  detailsData,
}: {
  pages: BoardPage[];
  components: BoardComponent[];
  projectId: string;
  projectName: string;
  showDetails?: boolean;
  detailsData?: ArchitectureNodeDetails | null;
}) {
  const { fitBounds } = useReactFlow();

  const [childParentSlug, setChildParentSlug] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [rootDialogOpen, setRootDialogOpen] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());

  const handleMeasure = useCallback((key: string, height: number) => {
    setHeights((current) => {
      // Sub-pixel churn would relayout forever; only a real change counts.
      if (Math.abs((current.get(key) ?? 0) - height) < 1) return current;
      const next = new Map(current);
      next.set(key, height);
      return next;
    });
  }, []);

  const actions = useMemo<NodeActions>(
    () => ({
      onAddChild: setChildParentSlug,
      // A folder path has no page, so "create page here" opens the same
      // dialog but seeded with the folder's OWN path as the parent.
      onCreateAtPath: setChildParentSlug,
      onToggleCollapse: (key) =>
        setCollapsed((current) => {
          const next = new Set(current);
          if (!next.delete(key)) next.add(key);
          return next;
        }),
      onComponentClick: (componentId) => {
        setSelectedComponentId(componentId);
        setPanelOpen(true);
      },
      onMeasure: handleMeasure,
    }),
    [handleMeasure],
  );

  const layout = useMemo(
    () => layoutPageTree(pruneCollapsed(buildPageTree(pages), collapsed), DEFAULT_LAYOUT, heights),
    [pages, collapsed, heights],
  );

  // Rollups are computed once per pages/detailsData change, not per node --
  // computeRollups walks every page/section once and returns a stable Map
  // that every SitemapNode looks up by id.
  const rollups = useMemo(
    () => (showDetails && detailsData ? computeRollups(pages, detailsData) : null),
    [showDetails, detailsData, pages],
  );

  const computedNodes = useMemo<Node[]>(
    () =>
      layout.nodes.map((node) => ({
        id: node.key || "__root__",
        type: "sitemap",
        position: { x: node.x, y: node.y },
        data: {
          node,
          actions,
          components,
          showDetails,
          detailsData: detailsData ?? null,
          rollups,
        } as unknown as Record<string, unknown>,
        // React Flow keeps a node `visibility: hidden` until its box has
        // been measured; seeding the size the layout already computed
        // lets the first paint show the tree instead of an empty canvas,
        // and the real measurement corrects it a frame later.
        initialWidth: node.width,
        initialHeight: node.height,
        // Positions are owned by the layout, so nodes are read-only pins.
        draggable: false,
        connectable: false,
      })),
    [layout, actions, components, showDetails, detailsData, rollups],
  );

  const connectors = useMemo(() => buildConnectors(layout.nodes), [layout]);
  const bounds = useMemo(() => treeBounds(layout.nodes), [layout]);

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);

  // The layout is the source of truth for position and data, but React
  // Flow stores each node's measured box ON the node object -- replacing
  // the array wholesale throws that away, and an unmeasured node has no
  // handle bounds, so its edges silently stop rendering and
  // useNodesInitialized never flips (this bit when toggling back from the
  // column view). Merge by id instead: keep whatever React Flow measured,
  // overwrite only what the layout owns.
  useEffect(() => {
    setNodes((current) => {
      const previousById = new Map(current.map((node) => [node.id, node]));
      return computedNodes.map((next) => {
        const previous = previousById.get(next.id);
        return previous
          ? { ...previous, position: next.position, data: next.data }
          : next;
      });
    });
  }, [computedNodes, setNodes]);

  // fitBounds works off the layout's own extents, so framing the tree
  // never waits on React Flow measuring node boxes. It still needs the
  // instance to know its own size, which is only guaranteed from onInit
  // onwards -- this effect handles later layout changes (a page added, a
  // branch collapsed); `hasInit` keeps it from firing into a zero-sized
  // viewport before then, where it would silently do nothing.
  const [hasInit, setHasInit] = useState(false);
  useEffect(() => {
    if (!hasInit) return;
    const frame = requestAnimationFrame(() =>
      fitBounds(bounds, { padding: 0.12, duration: 200 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hasInit, bounds, fitBounds]);

  // React Flow needs a container with a definite width and height at the
  // moment it initialises -- a `w-full` box inside a flex column can still
  // be resolving to 0 on that first pass, and once React Flow has recorded
  // a 0x0 viewport it never measures nodes, so no edges render and fitView
  // is a no-op. An absolutely positioned child of a height-carrying
  // relative box sidesteps flex resolution entirely.
  // Same CSS-driven hover-linking the column board uses: hovering a
  // section highlights every other instance of its component.
  const hoverRef = useComponentHover<HTMLDivElement>();

  return (
    <div
      ref={hoverRef}
      className="relative w-full min-w-0 overflow-hidden rounded-lg border border-border bg-background"
      style={{ height: "calc(100vh - 340px)", minHeight: 420 }}
    >
      <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onInit={(instance) => {
          instance.fitBounds(bounds, { padding: 0.12 });
          setHasInit(true);
        }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        // Trackpad-first, the way Figma and Octopus.do behave: a two-finger
        // scroll pans on both axes, pinch zooms, and cmd/ctrl + wheel zooms.
        // React Flow's default (zoomOnScroll) turns every two-finger scroll
        // into a zoom, which leaves a trackpad with no way to move sideways
        // at all.
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Panel position="top-right" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRootDialogOpen(true)}
            className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover hover:text-foreground transition-colors"
          >
            <Plus className="size-3" aria-hidden />
            Add page
          </button>
          <button
            type="button"
            onClick={() => setPanelOpen((current) => !current)}
            aria-expanded={panelOpen}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover hover:text-foreground transition-colors"
          >
            Components
          </button>
          <button
            type="button"
            onClick={() => setIoOpen(true)}
            className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover hover:text-foreground transition-colors"
          >
            <ArrowUpDown className="size-3" aria-hidden />
            Import / Export
          </button>
        </Panel>
        {/* Connectors live inside the viewport portal so they pan and zoom
            with the nodes, drawn straight from the layout geometry. */}
        <ViewportPortal>
          <svg
            style={{
              position: "absolute",
              left: bounds.x,
              top: bounds.y,
              width: bounds.width,
              height: bounds.height,
              overflow: "visible",
              pointerEvents: "none",
            }}
          >
            <g transform={`translate(${-bounds.x} ${-bounds.y})`}>
              {connectors.map((connector) => (
                <path
                  key={connector.id}
                  d={connector.d}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              ))}
            </g>
          </svg>
        </ViewportPortal>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable className="!bg-card" maskColor="var(--background)" />
      </ReactFlow>
      </div>

      <CreatePageDialog
        projectId={projectId}
        parentSlug={childParentSlug ?? undefined}
        open={childParentSlug !== null}
        onOpenChange={(open) => {
          if (!open) setChildParentSlug(null);
        }}
      />

      <SitemapIoDialog
        pages={pages}
        projectId={projectId}
        projectName={projectName}
        detailsData={detailsData}
        open={ioOpen}
        onOpenChange={setIoOpen}
      />

      {/* Root-level page: no parentSlug, so the slug is proposed bare. */}
      <CreatePageDialog
        projectId={projectId}
        open={rootDialogOpen}
        onOpenChange={setRootDialogOpen}
      />

      {panelOpen ? (
        <ComponentPanel
          components={components}
          pages={pages}
          selectedComponentId={selectedComponentId}
          onSelectComponent={(component) => setSelectedComponentId(component.id)}
          onPageSelect={(pageId) => {
            const target = layout.nodes.find((node) => node.page?.id === pageId);
            if (!target) return;
            fitBounds(
              { x: target.x, y: target.y, width: target.width, height: target.height },
              { padding: 2, duration: 300 },
            );
          }}
          onClose={() => {
            setPanelOpen(false);
            setSelectedComponentId(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function CanvasBoard(props: {
  pages: BoardPage[];
  components: BoardComponent[];
  projectId: string;
  projectName: string;
  showDetails?: boolean;
  detailsData?: ArchitectureNodeDetails | null;
}) {
  return (
    <ReactFlowProvider>
      <SitemapCanvas {...props} />
    </ReactFlowProvider>
  );
}
