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
import { useEffect, useRef, useState } from "react";

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
// Overview polish pass (2026-09-08): this is the most important visual
// element on the client portal's most important page ("Where we are" is
// now full-width, see the Overview page's own layout comment) -- rows
// bumped up again from 40/16/20 to 52/20/24 so the chart reads as
// spacious and confident rather than cramped, while keeping the exact
// same per-row-height-derives-everything approach (`rowHeightForPhase`)
// so the label column and the SVG bar/tick positions still cannot drift
// apart.
const BASE_ROW_HEIGHT_PX = 52;
const INFLIGHT_LINE_HEIGHT_PX = 20;
const BAR_HEIGHT_PX = 24;
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

// F104 round 4: the mobile stacked-card layout draws its bars as plain
// `<div>`s (percentage widths), not SVG `<rect>`s, so it needs the same
// four colours as `bg-*` utilities rather than `fill-*`.
const STATE_BG_CLASS: Record<PortalPhaseState, string> = {
  not_started: "bg-muted-foreground/50",
  active: "bg-status-progress",
  blocked: "bg-status-blocked",
  done: "bg-status-done",
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

/** F104 1.3: the row's facts line, kept to STATE + DATES + COUNT -- three
 * facts, not four, and no longer a single middot run-on string in one
 * grey weight. This function stays the single source of truth for what
 * goes in it, so the row label, its `aria-label` and its tooltip can
 * never disagree (docs/portal-timeline-review-and-demo-readiness.md
 * 1.2/2.1).
 *
 * F104 round 3: NEVER append a qualifier here. Round 2 fixed the
 * in-flight title truncating when appended to this line; the coordinator
 * then found the exact same defect on a second qualifier -- a blocked
 * phase's "not yet started" note -- because it was still being pushed
 * onto this string. Both qualifiers now live in `formatQualifierLine`
 * below instead, which is the ONE place any future qualifier is added,
 * so this class of bug (four facts and a truncating fifth squeezed onto
 * one line) cannot recur a third time. */
function formatPhaseFactsLine(phase: PortalPhase): string {
  const parts = [STATE_LABEL[phase.state]];
  const dateRange = formatPhaseDateRange(phase);
  if (dateRange) parts.push(dateRange);
  const progress = formatPhaseProgress(phase);
  if (progress) parts.push(progress);
  return parts.join(" · ");
}

/** F104 round 3: the ONE optional qualifier line under the facts line,
 * generalised from round 2's in-flight-only version. A phase's `state`
 * is exclusive, so at most one of these ever applies to a given phase --
 * there is nothing to prioritise between them. Any FUTURE qualifier
 * (a third one, if the data ever grows one) belongs here too, never
 * appended to `formatPhaseFactsLine`, so it gets its own line and its
 * own row height for free instead of re-introducing the truncation bug
 * a third time. */
function formatQualifierLine(
  phase: PortalPhase,
): { kind: "inflight" | "blocked-note"; text: string } | null {
  if (phase.state === "active" && phase.inFlightTaskTitle) {
    return { kind: "inflight", text: `Now: ${phase.inFlightTaskTitle}` };
  }
  // F109 (docs/client-portal-visual-plan.md Part 4.1): a real, recorded
  // reason always wins over the derived "Not yet started" note -- it is
  // strictly more informative, and applies whether or not the phase has
  // an `actualStart` (a blocked phase can be blocked before OR after it
  // was actually under way). Falls back to the same derived note as
  // before when no reason has been recorded, and to nothing at all when
  // the phase is blocked, has an actual start, and no reason -- this
  // function still never invents one.
  if (phase.state === "blocked") {
    if (phase.blockedReason) {
      return { kind: "blocked-note", text: phase.blockedReason };
    }
    if (blockedNeverStarted(phase)) {
      return { kind: "blocked-note", text: "Not yet started" };
    }
  }
  return null;
}

/** F104 round 2/3: a row's own natural height, driven by its own content
 * rather than one constant shared by every row regardless of what it
 * holds. A phase with a qualifier line (in-flight OR the blocked "not
 * yet started" note) needs a third text line; one without needs only
 * two (name + facts). Both the label column and the SVG bar/tick
 * positions are derived from this same per-phase height so the two
 * coordinate systems -- text column and plot area -- cannot drift apart
 * the way a single fixed ROW_HEIGHT_PX did (coordinator review: the
 * in-flight line was overflowing into the next row). */
function rowHeightForPhase(phase: PortalPhase): number {
  return formatQualifierLine(phase) ? BASE_ROW_HEIGHT_PX + INFLIGHT_LINE_HEIGHT_PX : BASE_ROW_HEIGHT_PX;
}

/** The full plain-text summary of a row -- facts line plus, when present,
 * its one qualifier line -- used everywhere the two need to combine into
 * one string (aria-label, tooltip body, and the row-label test hook).
 * Kept as one function so aria-label / tooltip / visible text can never
 * disagree with each other. */
function formatPhaseSecondaryLine(phase: PortalPhase): string {
  const facts = formatPhaseFactsLine(phase);
  const qualifier = formatQualifierLine(phase);
  return qualifier ? `${facts} · ${qualifier.text}` : facts;
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
  /** F131: the plot area's real, measured container width in pixels, when
   * known. When provided (and there is at least one dated phase, so
   * there is a real day axis to stretch), the whole axis -- from the
   * project's own start date to its own end/launch date -- is scaled to
   * fill exactly this width, replacing the previous fixed
   * `PX_PER_DAY`-per-day width that left empty space (or required
   * horizontal scroll) whenever the container was wider than the
   * computed day count warranted. Omitted (or `undefined`) on the
   * server-rendered first pass, before the client has measured its own
   * container, and in every existing unit test that calls this function
   * directly -- both keep the previous fixed-width behaviour so neither
   * SSR output nor test expectations shift. */
  targetWidthPx?: number,
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
  // F131: when a real measured container width is available, the axis's
  // pixels-per-day is DERIVED from it (chartWidthPx fills the container
  // exactly, pxPerDay is whatever that implies) instead of pxPerDay being
  // the fixed constant and chartWidthPx following from it -- the fix for
  // "this only fills half the wrapper" has to make the WIDTH the fixed
  // quantity, not the day-scale.
  const chartWidthPx =
    targetWidthPx !== undefined
      ? Math.max(targetWidthPx, MIN_BAR_WIDTH_PX + RANGE_END_PAD_PX)
      : Math.max(totalDays * PX_PER_DAY + RANGE_END_PAD_PX, 1);
  const pxPerDay =
    targetWidthPx !== undefined
      ? Math.max(chartWidthPx - RANGE_END_PAD_PX, MIN_BAR_WIDTH_PX) / totalDays
      : PX_PER_DAY;

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
      const xPx = diffDays(rangeStart, start) * pxPerDay;
      const widthPx = Math.max(diffDays(start, end) * pxPerDay, MIN_BAR_WIDTH_PX);
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
      xPx: offset * pxPerDay,
      // Label every OTHER week -- this feature's own explicit
      // instruction, so the axis stays readable at the chart's actual
      // pixel density instead of a label every 6px-scaled week.
      label: weekIndex % 2 === 0 ? formatWeekLabel(markDate) : null,
    });
    weekIndex += 1;
  }

  const todayXPx = diffDays(rangeStart, today) * pxPerDay;

  return { rows, chartWidthPx, contentHeightPx, weekMarks, todayXPx };
}

/**
 * F104 round 4: a phase's own elapsed-time share (0..1) within its OWN
 * planned date range, independent of `state` or task counts -- the one
 * piece of date maths both the desktop today-line and the mobile
 * per-card today marker need. Returns null whenever there is nothing to
 * mark: the phase has no planned range, the range is zero-length, or
 * today falls outside it. Kept as the single source of this arithmetic
 * so `computeExpectedProgress` below (which layers a state/task-count
 * gate on top for the "behind pace" cue) and the plain today marker can
 * never compute two different elapsed fractions for the same phase.
 */
function computeElapsedSharePercent(phase: PortalPhase, todayIso: string): number | null {
  if (!phase.plannedStart || !phase.plannedEnd) return null;

  const start = parseDateOnly(phase.plannedStart);
  const end = parseDateOnly(phase.plannedEnd);
  const today = parseDateOnly(todayIso);
  if (!start || !end || !today) return null;

  const totalSpan = diffDays(start, end);
  if (totalSpan <= 0) return null;
  if (today < start || today > end) return null;

  const elapsed = diffDays(start, today);
  return Math.min(Math.max(elapsed / totalSpan, 0), 1);
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
  if (phase.totalClientVisibleTasks === 0) return null;

  const elapsedShare = computeElapsedSharePercent(phase, todayIso);
  if (elapsedShare === null) return null;

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
  // F131: the plot's own measured width, read from the scroll/plot
  // container itself via ResizeObserver rather than assumed from the
  // viewport -- the label column beside it (`w-56`/`sm:w-72`) and any
  // future breakpoint change to it both shrink or grow how much width is
  // actually left for the plot, and this must always reflect that real
  // remaining width, not a guess. `null` until the first observation
  // fires (server render and the very first client paint), during which
  // `computePhaseTimelineLayout` below falls back to its previous fixed
  // day-based width so nothing is ever zero-width or absent.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidthPx, setContainerWidthPx] = useState<number | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    // Guard for a test environment (jsdom) with no `ResizeObserver` global
    // at all -- the fixed-width fallback in `computePhaseTimelineLayout`
    // then stays in effect for the whole test, exactly as it did before
    // this feature, rather than throwing.
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidthPx(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // AS-010's own failure case: a project with no phases renders the rest
  // of the overview without the timeline and without an error -- this
  // component's entire contract for that case is to render nothing.
  if (phases.length === 0) {
    return null;
  }

  const layout = computePhaseTimelineLayout(phases, today, containerWidthPx ?? undefined);
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

      {/* F104 round 4: the side-by-side label-column + shared-axis-plot
          arrangement below is a desktop idea -- on a 375px phone the
          fixed label column (`w-56`, `sm:w-72`) left the plot a
          49px-wide keyhole (coordinator measurement:
          `scroller clientW 49 / scrollW 330`), technically "the plot
          scrolls, the page doesn't" but practically no picture at all.
          `hidden lg:flex` keeps this exact layout, unchanged, at `lg`
          and above; `MobilePhaseList` below (`lg:hidden`) is a
          completely different shape for narrow screens rather than a
          shrunk version of this one. Both branches exist in the DOM
          unconditionally (a Tailwind breakpoint pair, not a JS
          media-query check) so there is no client/server hydration
          mismatch and no viewport-detection flash. */}
      <div data-testid="phase-timeline-desktop" className="hidden min-w-0 gap-3 lg:flex">
        {/* Row labels: a fixed, non-scrolling column so a phase's name
            and state stay readable even while the bar area (below)
            scrolls horizontally on a narrow screen. */}
        <div
          className="flex w-56 shrink-0 flex-col sm:w-72"
          style={{ paddingTop: HEADER_HEIGHT_PX }}
        >
          {layout.rows.map(({ phase, heightPx }) => {
            const factsLine = formatPhaseFactsLine(phase);
            const qualifierLine = formatQualifierLine(phase);
            return (
              <div
                key={phase.id}
                style={{ height: heightPx }}
                className="flex flex-col justify-center gap-1 border-b border-border/50 py-1 pr-2"
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
                {/* F104 1.2/2.7 + round 3: any qualifier -- in-flight
                    work on an active phase, or the "not yet started"
                    note on a blocked-but-never-started one -- gets its
                    OWN line instead of being appended to the facts line
                    and truncated. Round 2 fixed this for the in-flight
                    case; round 3 generalises it via `formatQualifierLine`
                    so the blocked note (found truncating the same way,
                    "not yet …") gets the identical treatment, and any
                    future qualifier gets it for free too. */}
                {qualifierLine && (
                  <span
                    data-testid={
                      qualifierLine.kind === "inflight"
                        ? "phase-timeline-inflight"
                        : "phase-timeline-blocked-note"
                    }
                    className={cn(
                      "truncate text-xs font-medium",
                      qualifierLine.kind === "blocked-note"
                        ? "text-status-blocked"
                        : "text-foreground",
                    )}
                    title={qualifierLine.text}
                  >
                    {qualifierLine.text}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Bar area: the plot area now always fills 100% of the available
            width instead of rendering at a fixed day-count-derived width
            and leaving empty space when the container is wider than that.
            `containerWidthPx` (measured below via ResizeObserver) is fed
            back into `computePhaseTimelineLayout` as `targetWidthPx`, so
            every x-coordinate -- bars, week grid, today line -- is
            computed directly in real container pixels (day-per-pixel
            scales up or down to fit), rather than stretched afterwards
            with an SVG `viewBox` transform, which would have distorted
            (horizontally stretched) the week-label text along with the
            bars. Falls back to the old fixed day-based width for the one
            render before the ResizeObserver reports a size (or in a test
            environment with no layout at all), so there is no flash of
            an unstyled/zero-width chart. There is nothing left to
            horizontally scroll once the plot always matches its
            container, so the old `overflow-x-auto` scroll wrapper is now
            a plain full-width block (test id kept for existing test
            hooks). */}
        <div
          ref={scrollRef}
          data-testid="phase-timeline-scroll"
          className="min-w-0 flex-1"
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

      <MobilePhaseTimelineList phases={phases} today={today} />
    </div>
  );
}

/**
 * F104 round 4: the mobile ("Where we are") shape for below the `lg`
 * breakpoint -- one full-width stacked card per phase rather than a
 * shared time axis behind a narrow fixed label column. This deliberately
 * drops the shared axis (dataviz "one scale" only applies within a
 * single chart; two different chart shapes for two breakpoints, each
 * internally consistent, is not the same violation as mixing scales
 * inside one chart) in favour of each phase's own bar self-scaled to
 * its OWN date range -- full width, chosen from the plan's own listed
 * options ("drop the shared time axis on mobile and let each bar be a
 * self-scaled progress bar with its dates as text").
 *
 * The two signals the coordinator called out as required to survive the
 * breakpoint both do: the today marker (`computeElapsedSharePercent`,
 * drawn on any dated card whose own range contains today, matching the
 * desktop today-line's per-row behaviour rather than a single shared
 * ruler) and the behind/on-track cue (`computeExpectedProgress` /
 * `isBehindExpectedProgress`, unchanged, reused as-is). Because a phone
 * has no hover, the behind cue is not tooltip-only here -- it renders as
 * its own always-visible line under the bar
 * (`phase-timeline-mobile-behind-note`), and `clientDescription` (the
 * desktop tooltip's extra line) renders inline too, for the same reason.
 */
function MobilePhaseTimelineList({
  phases,
  today,
}: {
  phases: PortalPhase[];
  today: string;
}) {
  return (
    <div
      data-testid="phase-timeline-mobile"
      role="list"
      aria-label={buildTimelineSummary(phases)}
      className="flex flex-col gap-3 lg:hidden"
    >
      {phases.map((phase) => {
        const factsLine = formatPhaseFactsLine(phase);
        const qualifierLine = formatQualifierLine(phase);
        const progress = formatPhaseProgress(phase);
        const doneShare =
          progress && phase.totalClientVisibleTasks > 0
            ? phase.doneClientVisibleTasks / phase.totalClientVisibleTasks
            : null;
        const elapsedSharePercent = computeElapsedSharePercent(phase, today);
        const expected = computeExpectedProgress(phase, today);
        const behind = isBehindExpectedProgress(phase, today);

        const ariaLabelParts = [`${phase.name}: ${formatPhaseSecondaryLine(phase)}`];
        if (behind) ariaLabelParts.push("behind its expected pace for today");

        return (
          <div
            key={phase.id}
            data-testid="phase-timeline-mobile-row"
            data-state={phase.state}
            data-behind={behind}
            role="group"
            aria-label={ariaLabelParts.join(" -- ")}
            className="rounded-md border border-border p-3"
          >
            <span className="block truncate text-sm font-medium text-foreground">
              {phase.name}
            </span>

            <span data-testid="phase-timeline-mobile-facts" className="mt-0.5 block text-xs">
              <span className={cn("font-semibold", STATE_TEXT_CLASS[phase.state])}>
                {STATE_LABEL[phase.state]}
              </span>
              <span className="text-muted-foreground">
                {factsLine.slice(STATE_LABEL[phase.state].length)}
              </span>
            </span>

            {/* Same qualifier mechanism as the desktop row -- its own
                line, never appended to the facts line above, so the
                round-2/round-3 truncation defect cannot recur here
                either. */}
            {qualifierLine && (
              <span
                data-testid={
                  qualifierLine.kind === "inflight"
                    ? "phase-timeline-mobile-inflight"
                    : "phase-timeline-mobile-blocked-note"
                }
                className={cn(
                  "mt-0.5 block text-xs font-medium",
                  qualifierLine.kind === "blocked-note"
                    ? "text-status-blocked"
                    : "text-foreground",
                )}
              >
                {qualifierLine.text}
              </span>
            )}

            {/* The self-scaled bar: full card width, this phase's OWN
                date range only -- there is no shared ruler to agree with
                any other card, by design. */}
            <div
              data-testid="phase-timeline-mobile-bar"
              className="relative mt-2 h-5 w-full overflow-hidden rounded-md bg-muted-foreground/15"
            >
              {doneShare !== null ? (
                <>
                  <div
                    data-testid="phase-timeline-mobile-bar-done"
                    className={cn("absolute inset-y-0 left-0", STATE_BG_CLASS[phase.state])}
                    style={{ width: `calc(${doneShare * 100}% - 1px)` }}
                  />
                  <div
                    data-testid="phase-timeline-mobile-bar-remainder"
                    className={cn("absolute inset-y-0 right-0", STATE_BG_CLASS[phase.state])}
                    style={{ left: `calc(${doneShare * 100}% + 1px)`, opacity: 0.25 }}
                  />
                </>
              ) : (
                <div
                  data-testid="phase-timeline-mobile-bar-done"
                  className={cn("absolute inset-0", STATE_BG_CLASS[phase.state])}
                />
              )}

              {/* Today marker: this card's OWN elapsed-time share, drawn
                  only when today actually falls inside THIS phase's own
                  range -- the mobile equivalent of the desktop shared
                  dashed line, just evaluated per-card instead of once
                  for the whole chart. */}
              {elapsedSharePercent !== null && (
                <div
                  data-testid="phase-timeline-mobile-today"
                  aria-hidden="true"
                  className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-foreground"
                  style={{ left: `${elapsedSharePercent * 100}%` }}
                />
              )}

              {/* Expected-progress tick: identical rule to the desktop
                  bar (active, dated, has client-visible tasks, today
                  inside range). */}
              {expected !== null && (
                <div
                  data-testid="phase-timeline-mobile-expected-tick"
                  aria-hidden="true"
                  className={cn(
                    "absolute top-[-3px] bottom-[-3px] w-0.5",
                    behind ? "bg-status-blocked" : "bg-foreground/50",
                  )}
                  style={{ left: `${expected.elapsedShare * 100}%` }}
                />
              )}
            </div>

            {/* No hover on a phone: the behind cue and the phase's own
                client-facing note (the desktop tooltip's contents) are
                always-visible text here instead of hidden behind a
                pointer event that a touch screen never fires. */}
            {behind && (
              <p
                data-testid="phase-timeline-mobile-behind-note"
                className="mt-1 text-xs font-medium text-status-blocked"
              >
                Behind its expected pace for today.
              </p>
            )}
            {phase.clientDescription && (
              <p className="mt-1 text-xs text-muted-foreground">{phase.clientDescription}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
