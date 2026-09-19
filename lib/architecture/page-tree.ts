import type { BoardPage } from "@/lib/queries/architecture";

// Hierarchy for the Architecture canvas is derived from `page_slug`, not
// from a `parent_page_id` column -- standing decision 2 rules that column
// out, and AS-016 already allows nested slug segments ("services/seo").
// A sitemap IS a URL tree, so the slug path is the hierarchy: "services"
// is the parent of "services/seo". Re-parenting a page therefore means
// rewriting its slug prefix, not writing a separate edge table.
//
// A path segment that has children but no page of its own (say "legal"
// when only "legal/privacy" and "legal/terms" exist) is a FOLDER: a
// synthetic node with `page: null`, rendered as a grouping placeholder
// that can be materialised into a real page later.

export type PageTreeNode = {
  /** Full slug path, e.g. "services/seo". "" for the synthetic site root. */
  key: string;
  /** Last path segment, e.g. "seo". */
  segment: string;
  /** Display label -- the page title, or the humanised segment for folders. */
  label: string;
  /** The real page at this path, or null when this is a synthetic folder. */
  page: BoardPage | null;
  children: PageTreeNode[];
  depth: number;
};

/** Slugs treated as the site root rather than as a first-level child. */
const ROOT_SLUGS = new Set(["", "/", "home", "index"]);

function humanise(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normaliseSlug(slug: string): string {
  return slug.trim().replace(/^\/+|\/+$/g, "");
}

/**
 * Builds the page hierarchy from slug paths. Returns a single root node:
 * the page whose slug is home/index/"" when one exists, otherwise a
 * synthetic "Site" root. Intermediate segments with no page of their own
 * become folder nodes (`page: null`).
 */
export function buildPageTree(pages: BoardPage[]): PageTreeNode {
  const rootPage =
    pages.find((page) => ROOT_SLUGS.has(normaliseSlug(page.pageSlug))) ?? null;

  const root: PageTreeNode = {
    key: "",
    segment: "",
    label: rootPage?.title ?? "Site",
    page: rootPage,
    children: [],
    depth: 0,
  };

  // Index every node by its full path so intermediate folders are created
  // exactly once and a page arriving after its own children still claims
  // the folder node that was synthesised for it.
  const byKey = new Map<string, PageTreeNode>([["", root]]);

  function ensureNode(path: string[], depth: number): PageTreeNode {
    const key = path.join("/");
    const existing = byKey.get(key);
    if (existing) return existing;

    const segment = path[path.length - 1];
    const node: PageTreeNode = {
      key,
      segment,
      label: humanise(segment),
      page: null,
      children: [],
      depth,
    };
    byKey.set(key, node);

    const parent = ensureNode(path.slice(0, -1), depth - 1);
    parent.children.push(node);
    return node;
  }

  for (const page of pages) {
    if (page === rootPage) continue;
    const segments = normaliseSlug(page.pageSlug).split("/").filter(Boolean);
    if (segments.length === 0) continue;

    const node = ensureNode(segments, segments.length);
    node.page = page;
    node.label = page.title;
  }

  sortTree(root, pages);
  return root;
}

/** Folders first-come order is meaningless; sort by the page's own board position. */
function sortTree(node: PageTreeNode, pages: BoardPage[]) {
  const positionOf = (child: PageTreeNode) =>
    child.page ? child.page.position : Number.MAX_SAFE_INTEGER;
  node.children.sort((a, b) => positionOf(a) - positionOf(b) || a.segment.localeCompare(b.segment));
  for (const child of node.children) sortTree(child, pages);
}

/**
 * Returns a copy of the tree with the children of every collapsed node
 * dropped. Layout then treats a collapsed branch as a leaf, so the canvas
 * narrows instead of scrolling sideways forever -- the collapsed node
 * still reports `hiddenChildren` so the UI can show a count.
 */
export function pruneCollapsed(
  node: PageTreeNode,
  collapsed: ReadonlySet<string>,
): PageTreeNode & { hiddenChildren: number } {
  const isCollapsed = collapsed.has(node.key);
  return {
    ...node,
    hiddenChildren: isCollapsed ? node.children.length : 0,
    children: isCollapsed ? [] : node.children.map((child) => pruneCollapsed(child, collapsed)),
  };
}

export type LaidOutNode = PageTreeNode & {
  hiddenChildren?: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TreeLayout = {
  nodes: LaidOutNode[];
  edges: { source: string; target: string }[];
};

export type Connector = { id: string; d: string };

export type TreeBounds = { x: number; y: number; width: number; height: number };

/**
 * Orthogonal parent -> child connector paths, in the same flow coordinate
 * space as the node positions.
 *
 * These are drawn from the layout rather than as React Flow edges on
 * purpose: an edge's geometry comes from measured handle bounds, which
 * means it only appears once React Flow has observed every node box --
 * fragile on remount, and pointless here because the lines are a pure
 * function of the hierarchy, never user-drawn.
 */
export function buildConnectors(nodes: LaidOutNode[], radius = 10): Connector[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const connectors: Connector[] = [];

  for (const child of nodes) {
    if (child.depth === 0) continue;
    const parentKey = child.key.includes("/")
      ? child.key.slice(0, child.key.lastIndexOf("/"))
      : "";
    const parent = byKey.get(parentKey);
    if (!parent) continue;

    const startX = parent.x + parent.width / 2;
    const startY = parent.y + parent.height;
    const endX = child.x + child.width / 2;
    const endY = child.y;
    const midY = startY + (endY - startY) / 2;

    if (Math.abs(endX - startX) < 1) {
      connectors.push({ id: `${parentKey}->${child.key}`, d: `M${startX},${startY}L${endX},${endY}` });
      continue;
    }

    // Down to the midpoint, across, then down into the child -- with the
    // two turns rounded so the tree reads like a sitemap, not a circuit.
    const sweepRight = endX > startX;
    const r = Math.min(radius, Math.abs(endX - startX) / 2, Math.abs(midY - startY), Math.abs(endY - midY));
    const d = [
      `M${startX},${startY}`,
      `L${startX},${midY - r}`,
      `Q${startX},${midY} ${startX + (sweepRight ? r : -r)},${midY}`,
      `L${endX - (sweepRight ? r : -r)},${midY}`,
      `Q${endX},${midY} ${endX},${midY + r}`,
      `L${endX},${endY}`,
    ].join("");
    connectors.push({ id: `${parentKey}->${child.key}`, d });
  }

  return connectors;
}

/** Bounding box of the laid-out tree, for fitting the viewport without
 *  waiting on React Flow to measure anything. */
export function treeBounds(nodes: LaidOutNode[]): TreeBounds {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export type LayoutOptions = {
  nodeWidth: number;
  /** Height of a node with zero sections (header + the add-section row). */
  baseHeight: number;
  sectionHeight: number;
  horizontalGap: number;
  verticalGap: number;
};

// Sized against the real node chrome: a header row carrying the inline
// rename field, the static/CMS selector and the delete button, plus one
// SectionCard per section and the "Add section" control underneath.
export const DEFAULT_LAYOUT: LayoutOptions = {
  nodeWidth: 256,
  baseHeight: 84,
  sectionHeight: 38,
  horizontalGap: 36,
  verticalGap: 72,
};

/**
 * Measured heights win over the estimate whenever the canvas has reported
 * one. The estimate below is only ever a first-paint guess -- section rows
 * wrap, titles run to two lines, and a guess that runs short makes a card
 * overlap the row beneath it.
 */
function nodeHeight(
  node: PageTreeNode,
  options: LayoutOptions,
  measured?: ReadonlyMap<string, number>,
): number {
  const reported = measured?.get(node.key);
  if (reported !== undefined && reported > 0) return reported;
  const sections = node.page?.sections.length ?? 0;
  return options.baseHeight + sections * options.sectionHeight;
}

/**
 * Tidy top-down tree layout: every subtree is allocated a horizontal band
 * wide enough for its leaves, and each parent is centred over that band.
 * Rows are packed by the tallest node at each depth so a page with twelve
 * sections never overlaps the row beneath it.
 */
export function layoutPageTree(
  root: PageTreeNode,
  options: LayoutOptions = DEFAULT_LAYOUT,
  measuredHeights?: ReadonlyMap<string, number>,
): TreeLayout {
  const { nodeWidth, horizontalGap, verticalGap } = options;

  const spanCache = new Map<PageTreeNode, number>();
  function span(node: PageTreeNode): number {
    const cached = spanCache.get(node);
    if (cached !== undefined) return cached;

    let value = nodeWidth;
    if (node.children.length > 0) {
      const childrenWidth =
        node.children.reduce((total, child) => total + span(child), 0) +
        horizontalGap * (node.children.length - 1);
      value = Math.max(nodeWidth, childrenWidth);
    }
    spanCache.set(node, value);
    return value;
  }

  // Row Y offsets: depth N starts below the tallest node at depth N-1.
  const maxHeightByDepth = new Map<number, number>();
  (function measureDepths(node: PageTreeNode) {
    const height = nodeHeight(node, options, measuredHeights);
    maxHeightByDepth.set(node.depth, Math.max(maxHeightByDepth.get(node.depth) ?? 0, height));
    node.children.forEach(measureDepths);
  })(root);

  const rowY = new Map<number, number>();
  const maxDepth = Math.max(...maxHeightByDepth.keys());
  let cursorY = 0;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    rowY.set(depth, cursorY);
    cursorY += (maxHeightByDepth.get(depth) ?? options.baseHeight) + verticalGap;
  }

  const nodes: LaidOutNode[] = [];
  const edges: { source: string; target: string }[] = [];

  (function place(node: PageTreeNode, left: number) {
    const width = span(node);
    nodes.push({
      ...node,
      x: left + width / 2 - nodeWidth / 2,
      y: rowY.get(node.depth) ?? 0,
      width: nodeWidth,
      height: nodeHeight(node, options, measuredHeights),
    });

    const childrenWidth =
      node.children.reduce((total, child) => total + span(child), 0) +
      horizontalGap * Math.max(0, node.children.length - 1);
    let childLeft = left + (width - childrenWidth) / 2;

    for (const child of node.children) {
      edges.push({ source: node.key, target: child.key });
      place(child, childLeft);
      childLeft += span(child) + horizontalGap;
    }
  })(root, 0);

  return { nodes, edges };
}
