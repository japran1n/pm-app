"use client";

// F006 (missions/20260903-portal, AS-010): the overview's centrepiece --
// one inline SVG, no chart library, one row per client-visible phase
// (`getProjectPhases`, F001, already excludes any `client_visible = false`
// phase before this component ever sees it -- AS-012).
//
// AS-010: several phases can be `active` at once (the process
// "overlaps in the calendar," per docs/client-portal-sixstar-plan.md
// P1) -- this renders every row from its own `state`, independently, so
// N simultaneously-active phases render as N simultaneously-active bars.
// There is no "only one row can be active" logic anywhere in this file.
//
// Layout is a pure function (`computePhaseTimelineLayout`, exported for
// its own unit tests) kept separate from rendering: phases with BOTH a
// planned start and end are positioned on a real week axis; a phase
// missing either date falls back to an equal-width slot (in `position`
// order, among only the other dateless phases) rather than collapsing
// to zero width -- this feature's own explicit instruction. Because
// every phase is its own ROW, a dateless phase's equal-width bar never
// visually collides with a dated phase's real-positioned bar in another
// row; there is nothing to reconcile between the two coordinate schemes.
//
// Colour: `state` maps onto the F004 status tokens (`--status-*`,
// app/globals.css) -- `active` -> progress, `blocked` -> blocked,
// `done` -> done. `not_started` has no status-token counterpart (the
// four tokens are the client-facing STATUS buckets, a different
// vocabulary that happens to share three of four names with phase
// STATE) and is rendered muted instead, per this feature's own explicit
// "not-started phases are muted" instruction. Every bar's state is also
// stated in the row's own text label and the legend below -- colour is
// never the only signal (plan.md's Design constraint #4).
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { PortalPhase, PortalPhaseState } from "@/lib/queries/portal";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PX_PER_DAY = 6;
const MIN_CHART_DAYS = 21;
const MIN_BAR_WIDTH_PX = 24;
const FALLBACK_SLOT_WIDTH_PX = 96;
const ROW_HEIGHT_PX = 44;
const BAR_HEIGHT_PX = 16;
const HEADER_HEIGHT_PX = 24;

const STATE_ORDER: PortalPhaseState[] = ["not_started", "active", "blocked", "done"];

const STATE_LABEL: Record<PortalPhaseState, string> = {
  not_started: "Not started",
  active: "Active",
  blocked: "Blocked",
  done: "Done",
};

const STATE_TRACK_CLASS: Record<PortalPhaseState, string> = {
  not_started: "fill-muted",
  active: "fill-status-progress-bg",
  blocked: "fill-status-blocked-bg",
  done: "fill-status-done-bg",
};

const STATE_FILL_CLASS: Record<PortalPhaseState, string> = {
  not_started: "fill-muted-foreground/50",
  active: "fill-status-progress",
  blocked: "fill-status-blocked",
  done: "fill-status-done",
};

const STATE_DOT_CLASS: Record<PortalPhaseState, string> = {
  not_started: "bg-muted-foreground/50",
  active: "bg-status-progress",
  blocked: "bg-status-blocked",
  done: "bg-status-done",
};

const STATE_TEXT_CLASS: Record<PortalPhaseState, string> = {
  not_started: "text-muted-foreground",
  active: "text-status-progress",
  blocked: "text-status-blocked",
  done: "text-status-done",
};

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0, 0));
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function formatWeekLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export type PhaseTimelineRow = {
  phase: PortalPhase;
  xPx: number;
  widthPx: number;
  /** True when this bar used the equal-width fallback because the phase
   * is missing a planned start and/or end date. */
  fallback: boolean;
};

export type PhaseTimelineLayout = {
  rows: PhaseTimelineRow[];
  chartWidthPx: number;
  weekMarks: { xPx: number; label: string | null }[];
  todayXPx: number | null;
};

/**
 * Pure layout math, no DOM. Exported for direct unit testing (AS-010's
 * primary/failure cases, plus the dateless-fallback case, are all easier
 * to assert here than through rendered pixel positions).
 */
export function computePhaseTimelineLayout(
  phases: PortalPhase[],
  todayIso: string,
): PhaseTimelineLayout {
  const datedPhases = phases.filter((p) => p.plannedStart && p.plannedEnd);

  if (datedPhases.length === 0) {
    // No phase in this project has a planned date at all -- every phase
    // falls back to an equal-width slot in position order rather than
    // collapsing to zero width. There is no date axis to draw.
    const chartWidthPx = Math.max(phases.length, 1) * FALLBACK_SLOT_WIDTH_PX;
    return {
      rows: phases.map((phase, index) => ({
        phase,
        xPx: index * FALLBACK_SLOT_WIDTH_PX,
        widthPx: FALLBACK_SLOT_WIDTH_PX - 8,
        fallback: true,
      })),
      chartWidthPx,
      weekMarks: [],
      todayXPx: null,
    };
  }

  const today = parseDateOnly(todayIso) ?? new Date();

  let rangeStart = datedPhases.reduce<Date>((min, p) => {
    const d = parseDateOnly(p.plannedStart!)!;
    return d < min ? d : min;
  }, parseDateOnly(datedPhases[0]!.plannedStart!)!);
  let rangeEnd = datedPhases.reduce<Date>((max, p) => {
    const d = parseDateOnly(p.plannedEnd!)!;
    return d > max ? d : max;
  }, parseDateOnly(datedPhases[0]!.plannedEnd!)!);

  // Extend the range to always include "today" -- the today rule has to
  // land somewhere inside the drawn axis, not off the edge of it.
  if (today < rangeStart) rangeStart = today;
  if (today > rangeEnd) rangeEnd = today;

  const totalDays = Math.max(diffDays(rangeStart, rangeEnd), MIN_CHART_DAYS);
  const chartWidthPx = totalDays * PX_PER_DAY;

  const datelessPhases = phases.filter((p) => !(p.plannedStart && p.plannedEnd));
  const datelessSlotWidth =
    datelessPhases.length > 0 ? chartWidthPx / datelessPhases.length : 0;

  let datelessIndex = 0;
  const rows: PhaseTimelineRow[] = phases.map((phase) => {
    if (phase.plannedStart && phase.plannedEnd) {
      const start = parseDateOnly(phase.plannedStart)!;
      const end = parseDateOnly(phase.plannedEnd)!;
      const xPx = diffDays(rangeStart, start) * PX_PER_DAY;
      const widthPx = Math.max(diffDays(start, end) * PX_PER_DAY, MIN_BAR_WIDTH_PX);
      return { phase, xPx, widthPx, fallback: false };
    }

    const xPx = datelessIndex * datelessSlotWidth;
    datelessIndex += 1;
    return {
      phase,
      xPx,
      widthPx: Math.max(datelessSlotWidth - 8, MIN_BAR_WIDTH_PX),
      fallback: true,
    };
  });

  const weekMarks: { xPx: number; label: string | null }[] = [];
  let weekIndex = 0;
  for (let offset = 0; offset <= totalDays; offset += 7) {
    const markDate = new Date(rangeStart.getTime() + offset * MS_PER_DAY);
    weekMarks.push({
      xPx: offset * PX_PER_DAY,
      // Label every OTHER week -- this feature's own explicit
      // instruction, so the axis stays readable at the chart's actual
      // pixel density instead of a label every 6px-scaled week.
      label: weekIndex % 2 === 0 ? formatWeekLabel(markDate) : null,
    });
    weekIndex += 1;
  }

  const todayXPx = diffDays(rangeStart, today) * PX_PER_DAY;

  return { rows, chartWidthPx, weekMarks, todayXPx };
}

function buildTimelineSummary(phases: PortalPhase[]): string {
  const counts = { not_started: 0, active: 0, blocked: 0, done: 0 };
  for (const phase of phases) counts[phase.state] += 1;

  const activeNames = phases.filter((p) => p.state === "active").map((p) => p.name);

  let summary =
    `Project timeline: ${phases.length} phase${phases.length === 1 ? "" : "s"}, ` +
    `${counts.done} done, ${counts.active} active, ${counts.blocked} blocked, ` +
    `${counts.not_started} not started.`;

  if (activeNames.length > 0) {
    summary += ` Currently active: ${activeNames.join(", ")}.`;
  }

  return summary;
}

export function PhaseTimeline({
  phases,
  today,
}: {
  phases: PortalPhase[];
  /** "YYYY-MM-DD", passed in from the server so the today rule is
   * computed from the same clock the rest of the page rendered with --
   * never `new Date()` inside a client component, which would risk a
   * hydration mismatch against the server-rendered markup. */
  today: string;
}) {
  const [hoveredPhaseId, setHoveredPhaseId] = useState<string | null>(null);

  // AS-010's own failure case: a project with no phases renders the rest
  // of the overview without the timeline and without an error -- this
  // component's entire contract for that case is to render nothing.
  if (phases.length === 0) {
    return null;
  }

  const layout = computePhaseTimelineLayout(phases, today);
  const hoveredRow = layout.rows.find((row) => row.phase.id === hoveredPhaseId) ?? null;
  const chartHeightPx = HEADER_HEIGHT_PX + layout.rows.length * ROW_HEIGHT_PX;

  return (
    <div
      role="img"
      aria-label={buildTimelineSummary(phases)}
      data-testid="phase-timeline"
      className="flex flex-col gap-4 rounded-lg border border-border p-5"
    >
      <h2 className="text-sm font-semibold text-foreground">Where we are</h2>

      <div className="flex gap-3">
        {/* Row labels: a fixed, non-scrolling column so a phase's name
            and state stay readable even while the bar area (below)
            scrolls horizontally on a narrow screen. */}
        <div
          className="flex w-36 shrink-0 flex-col sm:w-44"
          style={{ paddingTop: HEADER_HEIGHT_PX }}
        >
          {phases.map((phase) => (
            <div
              key={phase.id}
              style={{ height: ROW_HEIGHT_PX }}
              className="flex flex-col justify-center gap-0.5 border-b border-border/50 pr-2"
            >
              <span className="truncate text-sm font-medium text-foreground">
                {phase.position}. {phase.name}
              </span>
              <span className={cn("text-xs", STATE_TEXT_CLASS[phase.state])}>
                {STATE_LABEL[phase.state]} · {phase.progressPercent}%
              </span>
            </div>
          ))}
        </div>

        {/* Bar area: this is the ONLY part of the chart that scrolls --
            the page body itself never scrolls sideways (this feature's
            own explicit instruction). */}
        <div
          data-testid="phase-timeline-scroll"
          className="min-w-0 flex-1 overflow-x-auto"
        >
          <svg
            width={layout.chartWidthPx}
            height={chartHeightPx}
            role="presentation"
            className="block"
          >
            {layout.weekMarks.map((mark) => (
              <g key={mark.xPx}>
                <line
                  x1={mark.xPx}
                  x2={mark.xPx}
                  y1={HEADER_HEIGHT_PX}
                  y2={chartHeightPx}
                  className="stroke-border"
                  strokeWidth={1}
                />
                {mark.label && (
                  <text
                    x={mark.xPx + 4}
                    y={14}
                    className="fill-muted-foreground text-[10px]"
                  >
                    {mark.label}
                  </text>
                )}
              </g>
            ))}

            {layout.todayXPx !== null && (
              <g data-testid="phase-timeline-today">
                <line
                  x1={layout.todayXPx}
                  x2={layout.todayXPx}
                  y1={HEADER_HEIGHT_PX}
                  y2={chartHeightPx}
                  className="stroke-foreground"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                <text
                  x={layout.todayXPx + 4}
                  y={12}
                  className="fill-foreground text-[10px] font-medium"
                >
                  Today
                </text>
              </g>
            )}

            {layout.rows.map((row, index) => {
              const y =
                HEADER_HEIGHT_PX + index * ROW_HEIGHT_PX + (ROW_HEIGHT_PX - BAR_HEIGHT_PX) / 2;
              const fillWidth = Math.max(
                (row.widthPx * row.phase.progressPercent) / 100,
                row.phase.progressPercent > 0 ? 2 : 0,
              );

              return (
                <g
                  key={row.phase.id}
                  data-testid="phase-timeline-row"
                  data-phase-id={row.phase.id}
                  data-state={row.phase.state}
                  data-fallback={row.fallback}
                  tabIndex={0}
                  role="button"
                  aria-label={`${row.phase.name}: ${STATE_LABEL[row.phase.state]}, ${row.phase.progressPercent}% complete`}
                  onMouseEnter={() => setHoveredPhaseId(row.phase.id)}
                  onMouseLeave={() => setHoveredPhaseId(null)}
                  onFocus={() => setHoveredPhaseId(row.phase.id)}
                  onBlur={() => setHoveredPhaseId(null)}
                  className="cursor-pointer outline-none"
                >
                  <rect
                    x={row.xPx}
                    y={y}
                    width={row.widthPx}
                    height={BAR_HEIGHT_PX}
                    rx={3}
                    className={STATE_TRACK_CLASS[row.phase.state]}
                  />
                  <rect
                    x={row.xPx}
                    y={y}
                    width={fillWidth}
                    height={BAR_HEIGHT_PX}
                    rx={3}
                    className={STATE_FILL_CLASS[row.phase.state]}
                  />
                </g>
              );
            })}

            {/* AS-010's own "one tooltip element for the whole chart":
                a single, conditionally-rendered node whose content swaps
                to whichever bar is currently hovered/focused, rather
                than one tooltip per bar. Placed as a foreignObject in
                the hovered row's own coordinate space so it scrolls
                together with the bars it annotates. */}
            {hoveredRow && (
              <foreignObject
                x={Math.min(hoveredRow.xPx, Math.max(layout.chartWidthPx - 200, 0))}
                y={
                  HEADER_HEIGHT_PX +
                  layout.rows.findIndex((r) => r.phase.id === hoveredRow.phase.id) *
                    ROW_HEIGHT_PX +
                  ROW_HEIGHT_PX
                }
                width={200}
                height={80}
              >
                <div
                  role="tooltip"
                  data-testid="phase-timeline-tooltip"
                  className="w-fit max-w-48 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
                >
                  <p className="font-medium">{hoveredRow.phase.name}</p>
                  <p className="text-muted-foreground">
                    {hoveredRow.phase.progressPercent}% complete
                  </p>
                  {hoveredRow.phase.clientDescription && (
                    <p className="mt-1 text-muted-foreground">
                      {hoveredRow.phase.clientDescription}
                    </p>
                  )}
                </div>
              </foreignObject>
            )}
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {STATE_ORDER.map((state) => (
          <span key={state} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full", STATE_DOT_CLASS[state])}
            />
            {STATE_LABEL[state]}
          </span>
        ))}
      </div>
    </div>
  );
}
