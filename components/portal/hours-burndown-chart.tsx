"use client";

// F019 (missions/20260903-portal, AS-034): the portal's burn-down chart --
// inline SVG, no chart library, following the same "pure layout function
// kept separate from rendering" convention phase-timeline.tsx (F006)
// established (computePhaseTimelineLayout there / computeBurndownLayout
// here), for the same reason: the layout math is what AS-034's unit test
// needs to assert against, independent of rendered pixels.
//
// `project_hours_client` (F017/F017b) returns weekly totals only for
// weeks that actually have a billable entry -- there is no period_start/
// period_end in its payload at all (the portal has no client-visible read
// path to `project_budgets`' own date columns; see lib/queries/hours.ts's
// own header for why the two RPCs are structurally split). AUTONOMOUS
// DECISION (no clarification file exists for this feature -- see this
// mission's F019 handoff): "the period" this chart spreads the budget
// across is the observed week range -- from the first billable week
// through the later of (last billable week, the current week) -- not an
// official budget-period date the portal cannot see. This is disclosed
// verbatim in the caption below rather than silently implied, per this
// feature's own "do not imply a precision the number does not have"
// instruction.
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { ClientHoursWeek } from "@/lib/queries/hours";
import {
  computeBurndownSeries,
  isoWeekToMonday,
  formatWeekLabel,
  type BurndownPoint,
} from "@/lib/hours/burndown-series";

const WEEK_SPACING_PX = 56;
const CHART_HEIGHT_PX = 220;
const TOP_PAD_PX = 28;
const BOTTOM_PAD_PX = 28;
const LEFT_LABEL_WIDTH_PX = 44;

// F107 (missions/20260903-portal, docs/client-portal-visual-plan.md
// 2.3): the pure series/week-math functions moved to
// lib/hours/burndown-series.ts (no "use client", callable from a
// server component) -- re-exported here unchanged so this file's own
// component below and every existing caller/test of these names keep
// working without a second copy. See that module's own header for
// why the move was necessary (same class of defect as F069's
// lib/metrics/measurement-status.ts extraction).
export type { BurndownPoint } from "@/lib/hours/burndown-series";
export {
  computeBurndownSeries,
  isoWeekToMonday,
  enumerateIsoWeeks,
  formatWeekLabel,
} from "@/lib/hours/burndown-series";
export type BurndownLayout = {
  chartWidthPx: number;
  chartHeightPx: number;
  maxMinutes: number;
  usedPath: string;
  usedAreaPath: string;
  plannedPath: string | null;
  ceilingYPx: number | null;
  columns: {
    point: BurndownPoint;
    xPx: number;
    usedYPx: number;
    plannedYPx: number | null;
    label: string;
  }[];
  endpoint: { xPx: number; yPx: number; usedMinutes: number } | null;
};

/** Pure pixel layout, no DOM -- exported for AS-034's own unit test
 * (point count, endpoint label value, ceiling position). */
export function computeBurndownLayout(
  points: BurndownPoint[],
  soldMinutes: number | null,
): BurndownLayout {
  const chartWidthPx = Math.max(points.length - 1, 0) * WEEK_SPACING_PX + LEFT_LABEL_WIDTH_PX * 2;
  const chartHeightPx = CHART_HEIGHT_PX;
  const plottableHeight = chartHeightPx - TOP_PAD_PX - BOTTOM_PAD_PX;

  const maxUsed = points.reduce((max, p) => Math.max(max, p.usedMinutes), 0);
  const maxMinutes = Math.max(maxUsed, soldMinutes ?? 0, 1);

  function yFor(minutes: number): number {
    return TOP_PAD_PX + plottableHeight - (minutes / maxMinutes) * plottableHeight;
  }

  const columns = points.map((point, index) => ({
    point,
    xPx: LEFT_LABEL_WIDTH_PX + index * WEEK_SPACING_PX,
    usedYPx: yFor(point.usedMinutes),
    plannedYPx: soldMinutes === null ? null : yFor(point.plannedMinutes),
    label: formatWeekLabel(point.isoWeek),
  }));

  const usedPath = columns.map((c, i) => `${i === 0 ? "M" : "L"}${c.xPx},${c.usedYPx}`).join(" ");
  const usedAreaPath =
    columns.length > 0
      ? `${usedPath} L${columns[columns.length - 1]!.xPx},${yFor(0)} L${columns[0]!.xPx},${yFor(0)} Z`
      : "";
  const plannedPath =
    soldMinutes === null
      ? null
      : columns.map((c, i) => `${i === 0 ? "M" : "L"}${c.xPx},${c.plannedYPx}`).join(" ");

  const ceilingYPx = soldMinutes === null ? null : yFor(soldMinutes);

  const last = columns[columns.length - 1] ?? null;
  const endpoint = last
    ? { xPx: last.xPx, yPx: last.usedYPx, usedMinutes: last.point.usedMinutes }
    : null;

  return {
    chartWidthPx,
    chartHeightPx,
    maxMinutes,
    usedPath,
    usedAreaPath,
    plannedPath,
    ceilingYPx,
    columns,
    endpoint,
  };
}

function minutesToHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function buildChartSummary(points: BurndownPoint[], soldMinutes: number | null): string {
  if (points.length === 0) return "Hours burn-down: no billable hours logged yet.";
  const last = points[points.length - 1]!;
  const usedText = `${minutesToHours(last.usedMinutes)} used`;
  const budgetText = soldMinutes === null ? "no budget set" : `${minutesToHours(soldMinutes)} budget`;
  return `Hours burn-down: ${usedText} through the week of ${formatWeekLabel(last.isoWeek)}, against ${budgetText}.`;
}

export function HoursBurndownChart({
  weekly,
  soldMinutes,
  todayIso,
}: {
  weekly: ClientHoursWeek[];
  soldMinutes: number | null;
  todayIso: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const points = computeBurndownSeries(weekly, soldMinutes, todayIso);

  // Degenerate case: a budget exists but nothing has been logged against
  // it yet (this feature's operational reading of "a period that has not
  // started" -- see this component's own header for why the portal has
  // no other way to tell "not started yet" from "started, nothing logged"
  // apart from data itself). One honest line, no chart.
  if (points.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border p-5">
        <h2 className="text-mini font-semibold text-foreground">Hours</h2>
        <p className="text-mini text-muted-foreground" data-testid="hours-chart-not-started">
          {soldMinutes === null
            ? "No budget has been set for this project yet."
            : "No billable hours have been logged against this budget yet."}
        </p>
      </div>
    );
  }

  const layout = computeBurndownLayout(points, soldMinutes);
  const hovered = hoveredIndex !== null ? layout.columns[hoveredIndex] : null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-mini font-semibold text-foreground">Hours burn-down</h2>
        {soldMinutes === null && (
          <span className="text-micro text-muted-foreground" data-testid="hours-chart-no-budget">
            No budget set yet — showing hours used only.
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-micro text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-brand" />
          Used
        </span>
        {soldMinutes !== null && (
          <>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0 w-4 border-t-2 border-dashed border-muted-foreground"
              />
              Planned
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-px w-4 bg-foreground/50" />
              Budget ceiling
            </span>
          </>
        )}
      </div>

      <div
        role="group"
        aria-label={buildChartSummary(points, soldMinutes)}
        data-testid="hours-burndown-chart"
        className="overflow-x-auto"
      >
        <svg
          width={layout.chartWidthPx}
          height={layout.chartHeightPx}
          role="presentation"
          className="block"
        >
          {layout.ceilingYPx !== null && (
            <g data-testid="hours-chart-ceiling">
              <line
                x1={0}
                x2={layout.chartWidthPx}
                y1={layout.ceilingYPx}
                y2={layout.ceilingYPx}
                className="stroke-foreground/40"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              <text
                x={4}
                y={layout.ceilingYPx - 4}
                className="fill-muted-foreground text-[10px]"
              >
                Budget · {minutesToHours(soldMinutes!)}
              </text>
            </g>
          )}

          {layout.usedAreaPath && (
            <path d={layout.usedAreaPath} className="fill-brand/10" />
          )}

          {layout.plannedPath && (
            <path
              d={layout.plannedPath}
              fill="none"
              className="stroke-muted-foreground"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}

          <path d={layout.usedPath} fill="none" className="stroke-brand" strokeWidth={2} />

          {layout.endpoint && (
            <g data-testid="hours-chart-endpoint">
              <circle
                cx={layout.endpoint.xPx}
                cy={layout.endpoint.yPx}
                r={4}
                className="fill-brand"
              />
              <text
                x={Math.min(layout.endpoint.xPx + 6, layout.chartWidthPx - 60)}
                y={Math.max(layout.endpoint.yPx - 8, 12)}
                className="fill-foreground text-[11px] font-medium"
              >
                {minutesToHours(layout.endpoint.usedMinutes)} used
              </text>
            </g>
          )}

          {layout.columns.map((column, index) => (
            <g key={column.point.isoWeek}>
              <text
                x={column.xPx}
                y={layout.chartHeightPx - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {index % 2 === 0 ? column.label : ""}
              </text>
              {/* Invisible hit target for the crosshair -- one shared
                  tooltip element below, not one tooltip per week. */}
              <rect
                x={column.xPx - WEEK_SPACING_PX / 2}
                y={0}
                width={WEEK_SPACING_PX}
                height={layout.chartHeightPx}
                fill="transparent"
                data-testid="hours-chart-hit"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(index)}
                onBlur={() => setHoveredIndex(null)}
                tabIndex={0}
                role="button"
                aria-label={`Week of ${column.label}: ${minutesToHours(column.point.usedMinutes)} used${
                  soldMinutes !== null
                    ? `, ${minutesToHours(column.point.plannedMinutes)} planned`
                    : ""
                }`}
              />
              {hoveredIndex === index && (
                <line
                  x1={column.xPx}
                  x2={column.xPx}
                  y1={0}
                  y2={layout.chartHeightPx}
                  className="stroke-border"
                  strokeWidth={1}
                />
              )}
            </g>
          ))}

          {/* AS-034's own single shared tooltip element for the whole
              chart, matching phase-timeline.tsx's identical convention. */}
          {hovered && (
            <foreignObject
              x={Math.min(hovered.xPx, Math.max(layout.chartWidthPx - 170, 0))}
              y={8}
              width={170}
              height={78}
            >
              <div
                role="tooltip"
                data-testid="hours-chart-tooltip"
                className="w-fit max-w-40 rounded-md border border-border bg-popover p-2 text-micro text-popover-foreground shadow-md"
              >
                <p className="font-medium">Week of {hovered.label}</p>
                <p className="text-muted-foreground">
                  Used: {minutesToHours(hovered.point.usedMinutes)}
                </p>
                {soldMinutes !== null && (
                  <>
                    <p className="text-muted-foreground">
                      Planned: {minutesToHours(hovered.point.plannedMinutes)}
                    </p>
                    <p
                      className={cn(
                        "font-medium",
                        hovered.point.usedMinutes <= hovered.point.plannedMinutes
                          ? "text-status-done"
                          : "text-status-waiting",
                      )}
                    >
                      {hovered.point.usedMinutes <= hovered.point.plannedMinutes ? "Under" : "Over"}{" "}
                      by {minutesToHours(Math.abs(hovered.point.usedMinutes - hovered.point.plannedMinutes))}
                    </p>
                  </>
                )}
              </div>
            </foreignObject>
          )}
        </svg>
      </div>

      <p className="text-micro text-muted-foreground">
        Billable hours only. Internal review and rework are not billed to you.
        {soldMinutes !== null &&
          " Planned assumes the budget is spread evenly across the weeks shown here."}
      </p>
    </div>
  );
}
