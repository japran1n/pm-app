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
// F104 (docs/client-portal-visual-plan.md Part 1): rebuild pass. The
// x-range now ends shortly past the last phase's own end date (extended
// only far enough to also include "today" -- see rangeEnd below) instead
// of an arbitrary rounded boundary, which used to leave roughly a third
// of the plot empty. The legend is gone -- every row already states its
// own state as a coloured word, so a repeated dot legend taught nothing
// (no-colour-alone is satisfied at the row level instead). The bar now
// draws progress (done fraction filled, remainder in the same hue at low
// opacity with a small surface gap) instead of a single solid block that
// could not distinguish "3 of 5 done" from "1 of 4 done". An in-flight
// active phase gets its own second row line instead of an appended,
// truncating "now: ..." suffix. A phase that is both active and behind
// its own elapsed-time share gets a small expected-progress tick on the
// bar, explained in the tooltip -- a derived visual cue, never a status
// the data doesn't otherwise support.
//
// Colour: `state` maps onto the F004 status tokens (`--status-*`,
// app/globals.css) -- `active` -> progress, `blocked` -> blocked,
// `done` -> done. `not_started` has no status-token counterpart (the
// four tokens are the client-facing STATUS buckets, a different
// vocabulary that happens to share three of four names with phase
// STATE) and is rendered muted instead, per this feature's own explicit
// "not-started phases are muted" instruction. Every bar's state is also
// stated in the row's own text label -- colour is never the only signal
// (plan.md's Design constraint #4).
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { PortalPhase, PortalPhaseState } from "@/lib/queries/portal";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PX_PER_DAY = 6;
const MIN_CHART_DAYS = 21;
const MIN_BAR_WIDTH_PX = 24;
const FALLBACK_SLOT_WIDTH_PX = 96;
// F104: rows brought down and the bar brought up so the bar -- the
// loudest visual channel on the page -- dominates the row instead of a
// thin 12px stripe inside a 56px row. Two text lines (name + state line)
// at text-sm/text-xs still read comfortably at this height and stay
// above the 24px WCAG 2.5.8 minimum target size.
// F104 round 2: rows are no longer a single constant. A phase with no
// in-flight line needs two text lines (name + facts); an active phase
// WITH an in-flight line needs three, and forcing both into one fixed
// height made the third line overflow into the row below (coordinator
// review, round 2). `rowHeightForPhase` below derives each row's own
// height from its own content, and both the label column and the SVG
// bars are positioned from that same per-row measurement, so the two
// coordinate systems can never drift apart.
const BASE_ROW_HEIGHT_PX = 40;
const INFLIGHT_LINE_HEIGHT_PX = 16;
const BAR_HEIGHT_PX = 20;
const HEADER_HEIGHT_PX = 24;
// F104 1.5: gap between a bar's "done" fill and its lower-opacity
// remainder, per the dataviz skill's spacer rule for adjacent same-hue
// fills.
const PROGRESS_GAP_PX = 2;
// F104 1.1: pixels of breathing room kept past the last phase's end (or
// today, if that is later) instead of rounding out to an arbitrary week
// boundary.
const RANGE_END_PAD_PX = 24;

const STATE_LABEL: Record<PortalPhaseState, string> = {
  not_started: "Not started",
  active: "Active",
  blocked: "Blocked",
  done: "Done",
};

const STATE_FILL_CLASS: Record<PortalPhaseState, string> = {
  not_started: "fill-muted-foreground/50",
  active: "fill-status-progress",
  blocked: "fill-status-blocked",
  done: "fill-status-done",
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

// A phase's progress count -- never a bare percentage, which hides the
// denominator and, worse, reads as self-contradictory on a finished
// phase with nothing tracked ("Done · 0%").
function formatPhaseProgress(phase: PortalPhase): string | null {
  if (phase.totalClientVisibleTasks === 0) return null;
  return `${phase.doneClientVisibleTasks} of ${phase.totalClientVisibleTasks} done`;
}

function formatPhaseDateRange(phase: PortalPhase): string | null {
  const start = phase.plannedStart ? parseDateOnly(phase.plannedStart) : null;
  const end = phase.plannedEnd ? parseDateOnly(phase.plannedEnd) : null;
  if (!start || !end) return null;
  return `${formatWeekLabel(start)} – ${formatWeekLabel(end)}`;
}

/** Whether a blocked phase should say "not yet started": the data has no
 * blocker-reason field, and this component does not invent one, but
 * `actualStart` DOES say whether the stoppage is a real, live one or a
 * phase scheduled entirely in the future. */
function blockedNeverStarted(phase: PortalPhase): boolean {
  return phase.state === "blocked" && !phase.actualStart;
}

/** F104 1.3: the row's secondary line, kept to STATE + DATES + COUNT --
 * three facts, not four, and no longer a single middot run-on string in
 * one grey weight. The state/date/count line and the in-flight line are
 * composed separately by the caller so each can carry its own type
 * weight; this function stays the single source of truth for what goes
 * in each, so the row label, its `aria-label` and its tooltip can never
 * disagree (docs/portal-timeline-review-and-demo-readiness.md 1.2/2.1). */
function formatPhaseFactsLine(phase: PortalPhase): string {
  const parts = [STATE_LABEL[phase.state]];
  const dateRange = formatPhaseDateRange(phase);
  if (dateRange) parts.push(dateRange);
  const progress = formatPhaseProgress(phase);
  if (progress) parts.push(progress);
  if (blockedNeverStarted(phase)) parts.push("not yet started");
  return parts.join(" · ");
}

function formatInFlightLine(phase: PortalPhase): string | null {
  if (phase.state === "active" && phase.inFlightTaskTitle) {
    return `Now: ${phase.inFlightTaskTitle}`;
  }
  return null;
}

/** F104 round 2: a row's own natural height, driven by its own content
 * rather than one constant shared by every row regardless of what it
 * holds. A phase with an in-flight line needs a third text line; one
 * without needs only two (name + facts). Both the label column and the
 * SVG bar/tick positions are derived from this same per-phase height so
 * the two coordinate systems -- text column and plot area -- cannot
 * drift apart the way a single fixed ROW_HEIGHT_PX did (coordinator
 * review: the in-flight line was overflowing into the next row). */
function rowHeightForPhase(phase: PortalPhase): number {
  return formatInFlightLine(phase) ? BASE_ROW_HEIGHT_PX + INFLIGHT_LINE_HEIGHT_PX : BASE_ROW_HEIGHT_PX;
}

/** The full plain-text summary of a row -- facts line plus, when present,
 * the in-flight line -- used everywhere the two need to combine into one
 * string (aria-label, tooltip body, and the row-label test hook). Kept as
 * one function so aria-label / tooltip / visible text can never drift
 * apart from each other. */
function formatPhaseSecondaryLine(phase: PortalPhase): string {
  const facts = formatPhaseFactsLine(phase);
  const inFlight = formatInFlightLine(phase);
  return inFlight ? `${facts} · ${inFlight}` : facts;
}

export type PhaseTimelineRow = {
  phase: PortalPhase;
  xPx: number;
  widthPx: number;
  /** True when this bar used the equal-width fallback because the phase
   * is missing a planned start and/or end date. */
  fallback: boolean;
  /** This row's own top offset within the plot's content area (below the
   * header), derived from every preceding row's own height -- never a
   * fixed index * constant. */
  yPx: number;
  /** This row's own height, from `rowHeightForPhase` -- three lines for
   * an active phase with in-flight work, two otherwise. */
  heightPx: number;
};

export type PhaseTimelineLayout = {
  rows: PhaseTimelineRow[];
  chartWidthPx: number;
  /** Sum of every row's own heightPx -- the plot's content height below
   * the header, before HEADER_HEIGHT_PX is added by the caller. */
  contentHeightPx: number;
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
    let offsetPx = 0;
    const rows = phases.map((phase, index) => {
      const heightPx = rowHeightForPhase(phase);
      const row = {
        phase,
        xPx: index * FALLBACK_SLOT_WIDTH_PX,
        widthPx: FALLBACK_SLOT_WIDTH_PX - 8,
        fallback: true,
        yPx: offsetPx,
        heightPx,
      };
      offsetPx += heightPx;
      return row;
    });
    return {
      rows,
      chartWidthPx,
      contentHeightPx: offsetPx,
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

  // F104 1.1: the range ends shortly past the last phase's (or today's)
  // end -- a small fixed pixel pad, not a rounded-up week boundary --
  // rather than the previous MIN_CHART_DAYS floor stretching the axis
  // far past the last bar on short projects.
  const totalDaysRaw = diffDays(rangeStart, rangeEnd);
  const totalDays = Math.max(totalDaysRaw, Math.ceil(MIN_CHART_DAYS * 0.6));
  const chartWidthPx = Math.max(totalDays * PX_PER_DAY + RANGE_END_PAD_PX, 1);

  const datelessPhases = phases.filter((p) => !(p.plannedStart && p.plannedEnd));
  const datelessSlotWidth =
    datelessPhases.length > 0 ? chartWidthPx / datelessPhases.length : 0;

  let datelessIndex = 0;
  let rowOffsetPx = 0;
  const rows: PhaseTimelineRow[] = phases.map((phase) => {
    const heightPx = rowHeightForPhase(phase);
    const yPx = rowOffsetPx;
    rowOffsetPx += heightPx;

    if (phase.plannedStart && phase.plannedEnd) {
      const start = parseDateOnly(phase.plannedStart)!;
      const end = parseDateOnly(phase.plannedEnd)!;
      const xPx = diffDays(rangeStart, start) * PX_PER_DAY;
      const widthPx = Math.max(diffDays(start, end) * PX_PER_DAY, MIN_BAR_WIDTH_PX);
      return { phase, xPx, widthPx, fallback: false, yPx, heightPx };
    }

    const xPx = datelessIndex * datelessSlotWidth;
    datelessIndex += 1;
    return {
      phase,
      xPx,
      widthPx: Math.max(datelessSlotWidth - 8, MIN_BAR_WIDTH_PX),
      fallback: true,
      yPx,
      heightPx,
    };
  });
  const contentHeightPx = rowOffsetPx;

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

  return { rows, chartWidthPx, contentHeightPx, weekMarks, todayXPx };
}

/**
 * F104 1.5: for an active, dated phase that contains today, the fraction
 * of its own elapsed calendar time versus its own done-task fraction.
 * Returns null for every phase this comparison doesn't apply to (not
 * active, not dated, today outside its range, or nothing client-visible
 * to compare against) -- this is a derived cue drawn ONLY where the
 * underlying data supports it, never an invented status.
 */
function computeExpectedProgress(
  phase: PortalPhase,
  todayIso: string,
): { elapsedShare: number; doneShare: number } | null {
  if (phase.state !== "active") return null;
  if (!phase.plannedStart || !phase.plannedEnd) return null;
  if (phase.totalClientVisibleTasks === 0) return null;

  const start = parseDateOnly(phase.plannedStart);
  const end = parseDateOnly(phase.plannedEnd);
  const today = parseDateOnly(todayIso);
  if (!start || !end || !today) return null;

  const totalSpan = diffDays(start, end);
  if (totalSpan <= 0) return null;
  if (today < start || today > end) return null;

  const elapsed = diffDays(start, today);
  const elapsedShare = Math.min(Math.max(elapsed / totalSpan, 0), 1);
  const doneShare = phase.doneClientVisibleTasks / phase.totalClientVisibleTasks;

  return { elapsedShare, doneShare };
}

/** True only when a phase is both eligible for the comparison AND
 * actually behind -- elapsed time share meaningfully ahead of done
 * share. A small margin avoids flagging phases that are merely on pace. */
function isBehindExpectedProgress(phase: PortalPhase, todayIso: string): boolean {
  const expected = computeExpectedProgress(phase, todayIso);
  if (!expected) return false;
  return expected.elapsedShare - expected.doneShare > 0.05;
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
  const chartHeightPx = HEADER_HEIGHT_PX + layout.contentHeightPx;

  return (
    <div
      role="group"
      aria-label={buildTimelineSummary(phases)}
      data-testid="phase-timeline"
      // `min-w-0`: this component is placed inside a CSS grid column
      // (Overview page, `lg:grid-cols-3` -> `lg:col-span-2`) whose
      // default track min-width is `auto`, meaning it will NOT shrink
      // below its content's intrinsic width unless something in the
      // chain sets `min-width: 0`. Without it here, the SVG's own
      // intrinsic width could size the whole grid track (and therefore
      // the page) instead of scrolling inside `phase-timeline-scroll`
      // below -- the "clipped at the right edge of the viewport"
      // symptom this component must not cause regardless of its
      // parent's layout.
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border p-5"
    >
      <h2 className="text-sm font-semibold text-foreground">Where we are</h2>

      <div className="flex min-w-0 gap-3">
        {/* Row labels: a fixed, non-scrolling column so a phase's name
            and state stay readable even while the bar area (below)
            scrolls horizontally on a narrow screen. */}
        <div
          className="flex w-56 shrink-0 flex-col sm:w-72"
          style={{ paddingTop: HEADER_HEIGHT_PX }}
        >
          {layout.rows.map(({ phase, heightPx }) => {
            const factsLine = formatPhaseFactsLine(phase);
            const inFlightLine = formatInFlightLine(phase);
            return (
              <div
                key={phase.id}
                style={{ height: heightPx }}
                className="flex flex-col justify-center gap-0.5 border-b border-border/50 pr-2"
              >
                {/* Widened rather than truncated: phase names are short
                    and finite (docs/portal-timeline-review-and-demo-
                    readiness.md 2.4) -- `truncate` here used to cut
                    "Visual direction & design" mid-word, and a row you
                    cannot identify is worse than a wider one.

                    No `{phase.position}.` prefix: `position` is the
                    ordering column, and the row's own place in this
                    already-ordered list carries that sequence for free. */}
                <span className="truncate text-sm font-medium text-foreground">
                  {phase.name}
                </span>
                {/* F104 1.3: state/dates/count kept together as one line
                    but no longer sharing a single grey weight -- the
                    state word carries its own status colour+weight, the
                    dates and count are visually quieter. Combined here
                    into one `data-testid="phase-timeline-row-label"`
                    node (existing test contract) whose full text still
                    equals `formatPhaseSecondaryLine`. */}
                <span
                  data-testid="phase-timeline-row-label"
                  className="truncate text-xs"
                  title={formatPhaseSecondaryLine(phase)}
                >
                  <span className={cn("font-semibold", STATE_TEXT_CLASS[phase.state])}>
                    {STATE_LABEL[phase.state]}
                  </span>
                  <span className="text-muted-foreground">
                    {factsLine.slice(STATE_LABEL[phase.state].length)}
                  </span>
                </span>
                {/* F104 1.2/2.7: in-flight work gets its OWN line under
                    active phases instead of being appended to the facts
                    line and truncated -- this is the line a client reads
                    first. */}
                {inFlightLine && (
                  <span
                    data-testid="phase-timeline-inflight"
                    className="truncate text-xs font-medium text-foreground"
                    title={inFlightLine}
                  >
                    {inFlightLine}
                  </span>
                )}
              </div>
            );
          })}
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
                {/* Recessive grid: a thin, low-contrast rule, never
                    competing with the bars for attention. */}
                <line
                  x1={mark.xPx}
                  x2={mark.xPx}
                  y1={HEADER_HEIGHT_PX}
                  y2={chartHeightPx}
                  className="stroke-border/60"
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

            {layout.rows.map((row) => {
              const y =
                HEADER_HEIGHT_PX + row.yPx + (row.heightPx - BAR_HEIGHT_PX) / 2;
              const phase = row.phase;
              const progress = formatPhaseProgress(phase);
              const doneShare =
                progress && phase.totalClientVisibleTasks > 0
                  ? phase.doneClientVisibleTasks / phase.totalClientVisibleTasks
                  : null;

              // F104 1.4: progress drawn INSIDE the bar -- filled portion
              // for done, remainder in the same hue at low opacity, with
              // a small surface gap between the two segments -- rather
              // than one solid block that can't distinguish "3 of 5"
              // from "1 of 4". Phases with nothing client-visible to
              // count (progress === null) keep a single solid bar, since
              // there is no fraction to draw.
              const doneWidthPx =
                doneShare !== null
                  ? Math.max(row.widthPx * doneShare - PROGRESS_GAP_PX / 2, 0)
                  : row.widthPx;
              const remainderXPx = doneWidthPx + PROGRESS_GAP_PX;
              const remainderWidthPx = Math.max(row.widthPx - remainderXPx, 0);

              const expected = computeExpectedProgress(phase, today);
              const behind = isBehindExpectedProgress(phase, today);
              const expectedTickXPx =
                expected !== null ? row.xPx + row.widthPx * expected.elapsedShare : null;

              const ariaLabelParts = [`${phase.name}: ${formatPhaseSecondaryLine(phase)}`];
              if (behind) {
                ariaLabelParts.push("behind its expected pace for today");
              }

              return (
                <g
                  key={phase.id}
                  data-testid="phase-timeline-row"
                  data-phase-id={phase.id}
                  data-state={phase.state}
                  data-fallback={row.fallback}
                  data-behind={behind}
                  tabIndex={0}
                  role="button"
                  aria-label={ariaLabelParts.join(" -- ")}
                  onMouseEnter={() => setHoveredPhaseId(phase.id)}
                  onMouseLeave={() => setHoveredPhaseId(null)}
                  onFocus={() => setHoveredPhaseId(phase.id)}
                  onBlur={() => setHoveredPhaseId(null)}
                  className="cursor-pointer outline-none"
                >
                  {doneShare !== null ? (
                    <>
                      <rect
                        data-testid="phase-timeline-bar-done"
                        x={row.xPx}
                        y={y}
                        width={doneWidthPx}
                        height={BAR_HEIGHT_PX}
                        rx={3}
                        className={STATE_FILL_CLASS[phase.state]}
                      />
                      <rect
                        data-testid="phase-timeline-bar-remainder"
                        x={row.xPx + remainderXPx}
                        y={y}
                        width={remainderWidthPx}
                        height={BAR_HEIGHT_PX}
                        rx={3}
                        className={STATE_FILL_CLASS[phase.state]}
                        opacity={0.25}
                      />
                    </>
                  ) : (
                    <rect
                      data-testid="phase-timeline-bar-done"
                      x={row.xPx}
                      y={y}
                      width={row.widthPx}
                      height={BAR_HEIGHT_PX}
                      rx={3}
                      className={STATE_FILL_CLASS[phase.state]}
                    />
                  )}

                  {/* F104 1.5: expected-progress tick -- where the phase
                      SHOULD be if done share matched elapsed share.
                      Drawn only when the phase is active, dated, has
                      client-visible tasks, and today falls inside its
                      range; explained in the hover tooltip rather than
                      asserting a status on the row label. */}
                  {expectedTickXPx !== null && (
                    <line
                      data-testid="phase-timeline-expected-tick"
                      x1={expectedTickXPx}
                      x2={expectedTickXPx}
                      y1={y - 3}
                      y2={y + BAR_HEIGHT_PX + 3}
                      className={behind ? "stroke-status-blocked" : "stroke-foreground/50"}
                      strokeWidth={2}
                    />
                  )}
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
                x={Math.min(hoveredRow.xPx, Math.max(layout.chartWidthPx - 220, 0))}
                y={HEADER_HEIGHT_PX + hoveredRow.yPx + hoveredRow.heightPx}
                width={220}
                height={100}
              >
                <div
                  role="tooltip"
                  data-testid="phase-timeline-tooltip"
                  className="w-fit max-w-52 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
                >
                  <p className="font-medium">{hoveredRow.phase.name}</p>
                  <p className="text-muted-foreground">
                    {formatPhaseSecondaryLine(hoveredRow.phase)}
                  </p>
                  {isBehindExpectedProgress(hoveredRow.phase, today) && (
                    <p className="mt-1 text-status-blocked">
                      Behind its expected pace for today.
                    </p>
                  )}
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
    </div>
  );
}
