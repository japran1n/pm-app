// F239 (AS-455): dependency connectors, drawn as elbow lines between
// each blocking bar and its blocked bar. Server Component -- every
// position it draws is derived from typed props (real query results +
// the SAME `computeBarLayout`/row-position maths `TimelineBody` already
// used to place the bars themselves), so this overlay needs no client
// boundary of its own, and -- per the spec's Notes -- is ONE `<svg>`
// covering the whole scrollable date area rather than one per connector,
// so scroll performance doesn't degrade with many tasks.
//
// Decorative for screen readers (per the clarified spec): `aria-hidden`
// on the whole overlay -- the accessible source for a dependency
// relationship remains the textual "Blocked by"/"Blocks" list in the
// task detail sheet (components/task/dependencies.tsx, F156/F157),
// never this SVG.
//
// Leak safety: this component draws exactly the connectors
// `computeDependencyConnectors` (lib/timeline/layout.ts) hands it --
// that function already omits any edge whose endpoint lacks a known row
// position, and `getTimelineDependencyEdges`
// (lib/queries/timeline.ts) already constrained both endpoints of every
// edge it fetched to the caller's own visible task set. There is no
// third check here; this component never receives, and so can never
// render, an edge naming a task the caller cannot see.

import {
  computeDependencyConnectors,
  type TimelineBarLayout,
  type TimelineDependencyEdgeInput,
} from "@/lib/timeline/layout";

export function DependencyOverlay({
  edges,
  rowPositions,
  barLayouts,
  widthPx,
  heightPx,
  leftPx = 0,
}: {
  edges: TimelineDependencyEdgeInput[];
  rowPositions: Map<string, number>;
  barLayouts: Map<string, TimelineBarLayout>;
  widthPx: number;
  heightPx: number;
  /** offset from the scroll container's own left edge -- callers whose
   * date area sits to the right of a sticky name column (the timeline
   * page's own layout) pass that column's width here. */
  leftPx?: number;
}) {
  const connectors = computeDependencyConnectors(edges, rowPositions, barLayouts);

  if (connectors.length === 0) {
    return null;
  }

  return (
    <svg
      className="pointer-events-none absolute top-0 z-[5] overflow-visible"
      style={{ left: `${leftPx}px` }}
      width={widthPx}
      height={heightPx}
      aria-hidden="true"
      data-testid="timeline-dependency-overlay"
    >
      <defs>
        <marker
          id="timeline-dependency-arrow"
          viewBox="0 0 8 8"
          refX="6"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 Z" className="fill-muted-foreground/70" />
        </marker>
      </defs>
      {connectors.map((connector) => (
        <path
          key={connector.id}
          d={connector.d}
          data-testid="timeline-dependency-connector"
          data-dependency-id={connector.id}
          className="fill-none stroke-muted-foreground/60"
          strokeWidth={1.5}
          markerEnd="url(#timeline-dependency-arrow)"
        />
      ))}
    </svg>
  );
}
