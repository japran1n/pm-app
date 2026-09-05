"use client";

// F111 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.6):
// "the most persuasive chart a client can see, because it is evidence of
// steady motion rather than a claim of it" -- a thin bar per week, one
// scale, no legend (a single series needs none -- the title names it),
// following the exact SVG/hover conventions hours-burndown-chart.tsx
// (F019) already established for this portal: a pure layout function
// separate from the render, a shared single tooltip rather than one per
// bar, and a `overflow-x-auto` scroller so a long-running project's wide
// chart scrolls inside its own card instead of pushing the page sideways
// (the exact defect the phase timeline's own `min-w-0` fix, F104 round 3,
// exists to prevent -- the grid item this component sits in must carry
// that same class, not this file).
import { useState } from "react";

import { formatWeekLabel } from "@/lib/hours/burndown-series";
import type { WeeklyDeliveryWeek } from "@/lib/portal/weekly-delivery";

const BAR_WIDTH_PX = 18;
const BAR_GAP_PX = 2;
const COLUMN_WIDTH_PX = BAR_WIDTH_PX + BAR_GAP_PX;
const CHART_HEIGHT_PX = 140;
const TOP_PAD_PX = 16;
const BOTTOM_PAD_PX = 24;
const BAR_RADIUS_PX = 4;
const LEFT_PAD_PX = 8;

export type WeeklyDeliveryColumn = {
  week: WeeklyDeliveryWeek;
  xPx: number;
  barHeightPx: number;
  barYPx: number;
  label: string;
};

export type WeeklyDeliveryLayout = {
  chartWidthPx: number;
  chartHeightPx: number;
  baselineYPx: number;
  maxCount: number;
  columns: WeeklyDeliveryColumn[];
};

/** Pure pixel layout, no DOM -- directly unit-testable (column count,
 * baseline position, tallest bar's height) independent of rendered SVG. */
export function computeWeeklyDeliveryLayout(weeks: WeeklyDeliveryWeek[]): WeeklyDeliveryLayout {
  const chartHeightPx = CHART_HEIGHT_PX;
  const baselineYPx = chartHeightPx - BOTTOM_PAD_PX;
  const plottableHeight = baselineYPx - TOP_PAD_PX;
  const maxCount = weeks.reduce((max, week) => Math.max(max, week.count), 0);
  const chartWidthPx = LEFT_PAD_PX * 2 + Math.max(weeks.length, 1) * COLUMN_WIDTH_PX;

  const columns = weeks.map((week, index) => {
    const barHeightPx = maxCount === 0 ? 0 : (week.count / maxCount) * plottableHeight;
    return {
      week,
      xPx: LEFT_PAD_PX + index * COLUMN_WIDTH_PX,
      barHeightPx,
      barYPx: baselineYPx - barHeightPx,
      label: formatWeekLabel(week.isoWeek),
    };
  });

  return { chartWidthPx, chartHeightPx, baselineYPx, maxCount, columns };
}

function buildChartSummary(weeks: WeeklyDeliveryWeek[]): string {
  const total = weeks.reduce((sum, week) => sum + week.count, 0);
  if (weeks.length === 0) return "Weekly delivery rhythm: no data yet.";
  if (total === 0) {
    return `Weekly delivery rhythm: nothing has shipped yet across ${weeks.length === 1 ? "the project's one week so far" : `the project's ${weeks.length} weeks so far`}.`;
  }
  const first = formatWeekLabel(weeks[0]!.isoWeek);
  const last = formatWeekLabel(weeks[weeks.length - 1]!.isoWeek);
  return `Weekly delivery rhythm: ${total} task${total === 1 ? "" : "s"} shipped between the weeks of ${first} and ${last}.`;
}

export function WeeklyDeliveryChart({ weeks }: { weeks: WeeklyDeliveryWeek[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Degenerate case: the project itself has no span yet to plot (should
  // not happen in practice -- every project has a start date -- but a
  // failed/empty read degrading to zero weeks gets an honest line
  // instead of an empty card with no explanation).
  if (weeks.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border p-5">
        <h2 className="text-sm font-semibold text-foreground">Weekly delivery rhythm</h2>
        <p
          className="text-sm text-muted-foreground"
          data-testid="weekly-delivery-chart-no-span"
        >
          Nothing to show yet.
        </p>
      </div>
    );
  }

  const total = weeks.reduce((sum, week) => sum + week.count, 0);
  const layout = computeWeeklyDeliveryLayout(weeks);
  const hovered = hoveredIndex !== null ? layout.columns[hoveredIndex] : null;
  // Direct label only where the value matters (this rule's own wording):
  // the running total across the whole span, once, not a number stamped
  // on every bar.
  const totalLabel =
    total === 0
      ? "Nothing shipped yet"
      : `${total} client-visible task${total === 1 ? "" : "s"} shipped`;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Weekly delivery rhythm</h2>
        <span
          className="text-xs text-muted-foreground"
          data-testid="weekly-delivery-chart-total"
        >
          {totalLabel}
        </span>
      </div>

      <div
        role="group"
        aria-label={buildChartSummary(weeks)}
        data-testid="weekly-delivery-chart"
        className="overflow-x-auto"
      >
        <svg
          width={layout.chartWidthPx}
          height={layout.chartHeightPx}
          role="presentation"
          className="block"
        >
          {/* Recessive axis: one thin baseline, theme-token stroke so it
              reads in both light and dark, never a full axis/grid. */}
          <line
            x1={0}
            x2={layout.chartWidthPx}
            y1={layout.baselineYPx}
            y2={layout.baselineYPx}
            className="stroke-border"
            strokeWidth={1}
          />

          {layout.columns.map((column, index) => (
            <g key={column.week.isoWeek}>
              {/* 4px rounded data-end, anchored to the baseline; a
                  genuinely zero week draws a 0-height rect (no fake
                  sliver) -- its bar is honestly absent, but the always-
                  present baseline, the regular column spacing and the
                  hover layer below still make that absence legible as
                  "this week: 0" rather than a missing data point. */}
              <rect
                x={column.xPx}
                y={column.barYPx}
                width={BAR_WIDTH_PX}
                height={column.barHeightPx}
                rx={BAR_RADIUS_PX}
                className="fill-brand"
                data-testid={`weekly-delivery-bar-${column.week.isoWeek}`}
              />

              {/* Invisible hit target, wider than the mark, shared
                  tooltip below -- same convention as the burn-down
                  chart's per-week hit rects. */}
              <rect
                x={column.xPx - BAR_GAP_PX}
                y={0}
                width={COLUMN_WIDTH_PX}
                height={layout.chartHeightPx}
                fill="transparent"
                data-testid="weekly-delivery-hit"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(index)}
                onBlur={() => setHoveredIndex(null)}
                tabIndex={0}
                role="button"
                aria-label={`Week of ${column.label}: ${column.week.count} shipped`}
              />

              {/* No number on every bar (this rule's own wording) --
                  only every few week labels along the axis, mirroring
                  the burn-down chart's identical "every other week"
                  thinning so labels never collide at narrow spacing. */}
              {index % 2 === 0 && (
                <text
                  x={column.xPx + BAR_WIDTH_PX / 2}
                  y={layout.chartHeightPx - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {column.label}
                </text>
              )}
            </g>
          ))}

          {hovered && (
            <foreignObject
              x={Math.min(hovered.xPx, Math.max(layout.chartWidthPx - 140, 0))}
              y={4}
              width={140}
              height={44}
            >
              <div
                role="tooltip"
                data-testid="weekly-delivery-tooltip"
                className="w-fit max-w-36 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
              >
                <p className="font-medium">Week of {hovered.label}</p>
                <p className="text-muted-foreground">
                  {hovered.week.count} shipped
                </p>
              </div>
            </foreignObject>
          )}
        </svg>
      </div>

      <p className="text-xs text-muted-foreground">
        Client-visible tasks, counted in the week they were last marked
        done.
      </p>
    </div>
  );
}

export function totalWeeklyDeliveryCount(weeks: WeeklyDeliveryWeek[]): number {
  return weeks.reduce((sum, week) => sum + week.count, 0);
}
