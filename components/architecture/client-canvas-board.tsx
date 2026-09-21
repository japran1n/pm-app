"use client";

// Read-only counterpart to canvas-board.tsx for the client portal's
// architecture/sitemap page. Reuses the exact same tree layout functions
// (buildPageTree, layoutPageTree, pruneCollapsed, buildConnectors,
// treeBounds, DEFAULT_LAYOUT) so the portal's pan/zoom canvas can never
// disagree with the workspace board about what the hierarchy is.
//
// Every editing affordance from canvas-board.tsx's SitemapNode is gone:
// no AddSectionButton, no CreatePageDialog, no delete controls, no
// PageColumnHeader edit affordances, no SitemapIoDialog. Collapse toggles
// are kept as a pure navigation aid (folding a branch you don't need is
// not "editing" the sitemap), but there is no add-child button and no
// "create page here" affordance on folders.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  ViewportPortal,
  PanOnScrollMode,
  type Node,
  type NodeProps,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronUp, FolderClosed } from "lucide-react";

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
import { PageKindBadge } from "@/components/architecture/page-kind-badge";
import { sectionKindStaticTintClassName } from "@/lib/architecture/section-tint";
import { useComponentHover } from "@/lib/architecture/use-component-hover";

type NodeActions = {
  onToggleCollapse: (key: string) => void;
  onMeasure: (key: string, height: number) => void;
};

type ClientSitemapNodeData = {
  node: LaidOutNode;
  actions: NodeActions;
};

function nodeAccent(node: LaidOutNode): "folder" | "cms" | "" {
  if (node.page === null) return "folder";
  const kind = node.page.pageKind;
  return kind === "cms" || kind === "cms_template" ? "cms" : "";
}

function ClientSitemapNode({ data }: NodeProps) {
  const { node, actions } = data as ClientSitemapNodeData;
  const page = node.page;
  const isFolder = page === null;
  const accent = nodeAccent(node);

  // Same measured-height pattern as canvas-board.tsx: estimating from the
  // section count alone runs short whenever a title wraps.
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
      data-testid={isFolder ? `client-canvas-folder-${node.key}` : `client-canvas-page-${page.id}`}
      data-page-id={isFolder ? undefined : page.id}
      className={cn(
        "rounded-lg border bg-card shadow-xs transition-colors",
        accent === "folder" && "border-dashed border-folder-border bg-folder/5",
        accent === "cms" && "border-cms-border bg-cms/5",
        accent === "" && "border-border",
      )}
      style={{ width: DEFAULT_LAYOUT.nodeWidth }}
    >
      {isFolder ? (
        <div className="flex items-center gap-1.5 px-2.5 py-2">
          <FolderClosed className="size-3.5 shrink-0 text-folder-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-folder-foreground">
            {node.label}
          </span>
        </div>
      ) : (
        <>
          <div
            className={cn(
              "nodrag nopan flex items-center gap-2 border-b p-3",
              accent === "cms" ? "border-cms-border" : "border-border",
            )}
          >
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{page.title}</p>
            <PageKindBadge kind={page.pageKind} />
          </div>
          <div className="nodrag nopan flex flex-col gap-1.5 p-3">
            {page.sections.length === 0 ? (
              <p className="px-1 py-1 text-[11px] text-muted-foreground">No sections yet.</p>
            ) : (
              page.sections.map((section) => (
                <div
                  key={section.id}
                  data-testid={`client-canvas-section-${section.id}`}
                  data-component={section.component?.id ?? undefined}
                  data-section-kind={section.kind}
                  className={cn(
                    "w-full rounded-md border bg-card px-2 py-1.5 text-xs shadow-xs transition-colors",
                    sectionKindStaticTintClassName(section),
                  )}
                >
                  <p className="truncate font-medium">{section.title}</p>
                  {section.component ? (
                    <p className="truncate text-muted-foreground">{section.component.name}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Collapse is kept as a read-only navigation aid; there is no
          add-child button and folders get no "create page here" action. */}
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
      ) : node.children.length > 0 ? (
        <button
          type="button"
          onClick={() => actions.onToggleCollapse(node.key)}
          aria-label={`Collapse pages under ${node.label}`}
          className="nodrag absolute -bottom-2.5 left-1/2 z-10 flex size-5 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <ChevronUp className="size-3" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

const nodeTypes = { "client-sitemap": ClientSitemapNode };

function ClientCanvas({
  pages,
}: {
  pages: BoardPage[];
  components: BoardComponent[];
}) {
  const { fitBounds } = useReactFlow();

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());

  const handleMeasure = useCallback((key: string, height: number) => {
    setHeights((current) => {
      if (Math.abs((current.get(key) ?? 0) - height) < 1) return current;
      const next = new Map(current);
      next.set(key, height);
      return next;
    });
  }, []);

  const actions = useMemo<NodeActions>(
    () => ({
      onToggleCollapse: (key) =>
        setCollapsed((current) => {
          const next = new Set(current);
          if (!next.delete(key)) next.add(key);
          return next;
        }),
      onMeasure: handleMeasure,
    }),
    [handleMeasure],
  );

  const layout = useMemo(
    () => layoutPageTree(pruneCollapsed(buildPageTree(pages), collapsed), DEFAULT_LAYOUT, heights),
    [pages, collapsed, heights],
  );

  const computedNodes = useMemo<Node[]>(
    () =>
      layout.nodes.map((node) => ({
        id: node.key || "__root__",
        type: "client-sitemap",
        position: { x: node.x, y: node.y },
        data: { node, actions } as unknown as Record<string, unknown>,
        initialWidth: node.width,
        initialHeight: node.height,
        draggable: false,
        connectable: false,
        selectable: false,
      })),
    [layout, actions],
  );

  const connectors = useMemo(() => buildConnectors(layout.nodes), [layout]);
  const bounds = useMemo(() => treeBounds(layout.nodes), [layout]);

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);

  // Merge by id rather than replacing wholesale, same reasoning as
  // canvas-board.tsx: React Flow stores each node's measured box on the
  // node object, and losing that drops its edges.
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

  const [hasInit, setHasInit] = useState(false);
  const userHasInteracted = useRef(false);
  useEffect(() => {
    if (!hasInit) return;
    if (userHasInteracted.current) return;
    const frame = requestAnimationFrame(() =>
      fitBounds(bounds, { padding: 0.12, duration: 200 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hasInit, bounds, fitBounds]);

  const hoverRef = useComponentHover<HTMLDivElement>();

  return (
    <div
      ref={hoverRef}
      data-testid="client-canvas-board"
      className="relative w-full min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-background"
      style={{ minHeight: "max(420px, calc(100svh - 340px))" }}
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
          elementsSelectable={false}
          panOnDrag
          onMoveStart={() => {
            userHasInteracted.current = true;
          }}
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          {/* Connectors live inside the viewport portal so they pan and
              zoom with the nodes, drawn straight from layout geometry. */}
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
    </div>
  );
}

export function ClientCanvasBoard(props: { pages: BoardPage[]; components: BoardComponent[] }) {
  return (
    <ReactFlowProvider>
      <ClientCanvas {...props} />
    </ReactFlowProvider>
  );
}
