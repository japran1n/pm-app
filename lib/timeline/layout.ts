// F237 (AS-451, AS-452, AS-457, AS-458): pure, side-effect-free date/pixel
// maths for the timeline (Gantt-style) view. Same "UTC-anchored Date
// objects internally, DateOnly strings in/out, never an ambient-timezone
// round trip" convention as lib/calendar/month-grid.ts -- this module
// never reads `Intl.DateTimeFormat().resolvedOptions().timeZone` or the
// process environment; every "what day is it" question is answered by
// the caller passing a `DateOnly` "today" in (from
// lib/time/user-timezone.ts's `todayInTimeZone`, the same helper the
// calendar/My Tasks/overdue badge already share), never re-derived here.
//
// `tasks.start_date`/`tasks.due_date` are plain "YYYY-MM-DD" calendar
// dates with no time component (supabase/migrations/
// 20260828010000_tasks_start_date.sql's own doc comment). Every function
// here stays in that DateOnly string space for its public contract;
// internal day-count/positioning maths goes through UTC-noon-anchored
// `Date` objects (never `new Date(dateOnlyString)` at UTC MIDNIGHT, which
// is the exact "rolls back a day in a zone west of UTC once reformatted"
// bug class lib/time/user-timezone.ts's own comment documents and this
// module deliberately avoids by anchoring at UTC noon, mirroring
// month-grid.ts's `Date.UTC(year, month - 1, day, 12, 0, 0)` convention).

import type { DateOnly } from "@/lib/time/user-timezone";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default pixels-per-day at the (only, until F240's zoom levels land)
 * "month" scale this feature ships. F240's own zoom-level switcher is
 * the seam that varies this value -- this module takes it as an
 * explicit parameter everywhere rather than hard-coding it into the
 * layout maths, so F240 can plug in week/quarter values without
 * touching this file's functions. */
export const DEFAULT_PIXELS_PER_DAY = 32;

function parseDateOnly(value: DateOnly): Date | null {
  if (!DATE_ONLY_PATTERN.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function formatDateOnly(date: Date): DateOnly {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}` as DateOnly;
}

/** Exported for lib/timeline/reschedule.ts (F238, AS-454): the pure
 * drag/resize planning module needs the identical "shift a DateOnly by N
 * whole days, UTC-anchored" primitive this file already uses internally
 * -- reused rather than reimplemented, so there is exactly one
 * "DateOnly + days" function in the timeline feature, never two that
 * could drift apart. */
export function addDaysToDateOnly(value: DateOnly, days: number): DateOnly {
  const dt = parseDateOnly(value);
  if (!dt) throw new Error(`addDaysToDateOnly: invalid DateOnly "${value}"`);
  return formatDateOnly(new Date(dt.getTime() + days * MS_PER_DAY));
}

/**
 * Whole-day difference `b - a`, both "YYYY-MM-DD" -- UTC-anchored so a
 * DST transition in any local timezone never perturbs the count (this
 * is calendar-date subtraction, not an elapsed-instant calculation).
 * Throws on a malformed DateOnly (a programmer error at this layer --
 * callers validate/derive their DateOnly values upstream, same
 * convention lib/calendar/month-grid.ts's internal helpers use).
 */
export function diffCalendarDays(a: DateOnly, b: DateOnly): number {
  const da = parseDateOnly(a);
  const db = parseDateOnly(b);
  if (!da || !db) {
    throw new Error(`diffCalendarDays: invalid DateOnly ("${a}", "${b}")`);
  }
  return Math.round((db.getTime() - da.getTime()) / MS_PER_DAY);
}

/**
 * The default visible window this feature ships (no zoom switcher yet --
 * that is F240's own seam, AS-456, not this feature's assigned
 * assertion): a rolling 3-month window (the month before `year`/`month`,
 * that month itself, and the month after), anchored the same
 * "?month=YYYY-MM" URL-shareable way lib/calendar/month-grid.ts's
 * `currentMonthKey`/`monthDateRange` already do, so the two views share
 * one URL convention rather than inventing a second. Always spans a
 * whole number of calendar months (never a partial week/day at either
 * edge), which keeps `TimelineScale`'s month/week tick maths simple.
 */
export function timelineRangeForMonth(
  year: number,
  month: number,
): { start: DateOnly; end: DateOnly } {
  const anchor = new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
  const rangeStartDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1, 12, 0, 0));
  // Last day of the month AFTER `month`: day 0 of the month two after it.
  const rangeEndDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 2, 0, 12, 0, 0));
  return { start: formatDateOnly(rangeStartDate), end: formatDateOnly(rangeEndDate) };
}

export type TimelineTaskDates = {
  id: string;
  /** null when the task has no start date (AS-452). */
  startDate: DateOnly | null;
  /** null when the task has no due date. */
  dueDate: DateOnly | null;
};

export type TimelineBarLayout = {
  id: string;
  /** left offset, in px, from the start of the visible range. */
  leftPx: number;
  /** width, in px -- always at least one day wide. */
  widthPx: number;
  /**
   * "range": both a start and a due date are known, rendered as a bar
   * spanning the two (AS-451).
   * "marker": only one of the two dates is known, rendered as a
   * single-day marker on whichever date it has (AS-452 covers the
   * "no start date" case explicitly; the symmetric "no due date" case
   * gets the same single-day-marker treatment -- see this feature's
   * handoff AUTONOMOUS_DECISION for why both null-date cases collapse
   * to the same rendering rule).
   */
  kind: "range" | "marker";
  /** the single calendar date a "marker" bar is anchored to (undefined
   * for "range" bars, which span two dates instead). */
  markerDate?: DateOnly;
};

/**
 * True iff a task has at least one placeable date -- the only precondition
 * for appearing on the timeline at all. A task with NEITHER a start nor a
 * due date has nowhere to be positioned and is excluded from the
 * timeline entirely, mirroring the calendar's own "no due date = not on
 * the grid, explained by a footer count" precedent
 * (lib/queries/calendar.ts's getUndatedTaskCount / AS-446) rather than
 * inventing a third rendering rule for a task with literally no date
 * data.
 */
export function isPlaceableOnTimeline(task: TimelineTaskDates): boolean {
  return task.startDate !== null || task.dueDate !== null;
}

/**
 * Computes the bar/marker layout for one task against the visible
 * `rangeStart`..`rangeEnd` window, clipped to that window (a bar that
 * starts before `rangeStart` or ends after `rangeEnd` is clipped at the
 * edge, not drawn off-canvas -- the horizontal-scroll container,
 * AS-458, only ever needs to scroll within the rendered range itself).
 * Returns null for a task with no placeable date at all (see
 * `isPlaceableOnTimeline`) -- callers filter those out before ever
 * reaching this function's own row-rendering loop.
 *
 * Date combinations (AS-451, AS-452 + this feature's own
 * AUTONOMOUS_DECISION for the two null-date cases the assertions don't
 * name explicitly):
 *   - start AND due present: a "range" bar from start to due (AS-451).
 *   - due present, start absent: a "marker" on the due date (AS-452,
 *     named explicitly by the assertion text).
 *   - start present, due absent: a "marker" on the start date (the
 *     symmetric case AS-452 doesn't name; treated identically to keep
 *     one rendering rule for "exactly one date known" rather than two).
 *   - neither present: excluded entirely (see `isPlaceableOnTimeline`).
 */
export function computeBarLayout(
  task: TimelineTaskDates,
  rangeStart: DateOnly,
  rangeEnd: DateOnly,
  pixelsPerDay: number = DEFAULT_PIXELS_PER_DAY,
): TimelineBarLayout | null {
  if (!isPlaceableOnTimeline(task)) return null;

  const clamp = (d: DateOnly): DateOnly => {
    if (diffCalendarDays(rangeStart, d) < 0) return rangeStart;
    if (diffCalendarDays(rangeEnd, d) > 0) return rangeEnd;
    return d;
  };

  if (task.startDate !== null && task.dueDate !== null) {
    const start = clamp(task.startDate);
    const end = clamp(task.dueDate);
    const leftDays = diffCalendarDays(rangeStart, start);
    const spanDays = Math.max(diffCalendarDays(start, end), 0) + 1; // inclusive of both endpoints
    return {
      id: task.id,
      leftPx: leftDays * pixelsPerDay,
      widthPx: spanDays * pixelsPerDay,
      kind: "range",
    };
  }

  const markerDate = clamp((task.dueDate ?? task.startDate) as DateOnly);
  const leftDays = diffCalendarDays(rangeStart, markerDate);
  return {
    id: task.id,
    leftPx: leftDays * pixelsPerDay,
    widthPx: pixelsPerDay,
    kind: "marker",
    markerDate,
  };
}

/**
 * Left offset, in px, of "today"'s vertical line (AS-457) -- null when
 * `today` falls outside the visible range (the line is simply not
 * rendered rather than clamped to an edge, since a clamped line would
 * misleadingly claim today is a boundary day it isn't).
 */
export function todayLineOffsetPx(
  today: DateOnly,
  rangeStart: DateOnly,
  rangeEnd: DateOnly,
  pixelsPerDay: number = DEFAULT_PIXELS_PER_DAY,
): number | null {
  if (diffCalendarDays(rangeStart, today) < 0 || diffCalendarDays(rangeEnd, today) > 0) {
    return null;
  }
  return diffCalendarDays(rangeStart, today) * pixelsPerDay;
}

/** Total scrollable width, in px, of the visible range -- the date-area
 * container's own content width (AS-458: the container that scrolls,
 * not the page). */
export function timelineTotalWidthPx(
  rangeStart: DateOnly,
  rangeEnd: DateOnly,
  pixelsPerDay: number = DEFAULT_PIXELS_PER_DAY,
): number {
  return (diffCalendarDays(rangeStart, rangeEnd) + 1) * pixelsPerDay;
}

export type TimelineDayTick = {
  date: DateOnly;
  leftPx: number;
  /** true for the first day of a calendar month -- `TimelineScale` draws
   * a stronger divider/label there. */
  isMonthStart: boolean;
  /** F240 (AS-456): true for a Monday -- same `weekStartsOn: 1` Monday
   * convention lib/calendar/month-grid.ts's `CALENDAR_WEEK_STARTS_ON`
   * already fixes for this codebase, reused here rather than a second
   * week-start rule. Used by the "week" zoom level's day-granularity
   * header. */
  isWeekStart: boolean;
  /** F240 (AS-456): true for the first day of a calendar quarter
   * (Jan/Apr/Jul/Oct 1st). Used by the "quarter" zoom level's coarser
   * header. */
  isQuarterStart: boolean;
};

/** Every day in the visible range, positioned for the scale header --
 * one query's worth of pure maths, no per-day network/DB call. */
export function buildTimelineDayTicks(
  rangeStart: DateOnly,
  rangeEnd: DateOnly,
  pixelsPerDay: number = DEFAULT_PIXELS_PER_DAY,
): TimelineDayTick[] {
  const totalDays = diffCalendarDays(rangeStart, rangeEnd) + 1;
  const ticks: TimelineDayTick[] = [];
  for (let i = 0; i < totalDays; i += 1) {
    const date = addDaysToDateOnly(rangeStart, i);
    const parsed = parseDateOnly(date);
    if (!parsed) continue; // unreachable: `date` is always well-formed here.
    const day = parsed.getUTCDate();
    const month = parsed.getUTCMonth() + 1;
    const weekday = parsed.getUTCDay(); // 0 = Sunday .. 6 = Saturday (UTC-anchored, per this module's own convention)
    ticks.push({
      date,
      leftPx: i * pixelsPerDay,
      isMonthStart: day === 1,
      isWeekStart: weekday === 1,
      isQuarterStart: day === 1 && (month === 1 || month === 4 || month === 7 || month === 10),
    });
  }
  return ticks;
}

// F240 (AS-456): zoom levels. Each level is just a (pixelsPerDay, visible
// window width) pair layered on top of every F237/F238/F239 function
// above -- none of those functions were changed, since every one of them
// already took `pixelsPerDay` as an explicit parameter rather than
// baking `DEFAULT_PIXELS_PER_DAY` in (see this file's own header comment,
// written by F237 specifically to leave this seam for F240). Zooming
// changes pixels-per-day AND the width of the fetched/rendered window
// together, coarser zoom = more days visible in the same header
// granularity, so "quarter" is still a BOUNDED window (13 calendar
// months around the anchor), never an unbounded "whole workspace
// history" fetch.

export type TimelineZoomLevel = "week" | "month" | "quarter";

/** The exhaustive, ordered set of valid zoom levels -- exported so the
 * toolbar and the URL-param validator share one list rather than two. */
export const TIMELINE_ZOOM_LEVELS: readonly TimelineZoomLevel[] = ["week", "month", "quarter"];

/** "month" is the zoom level this feature's own predecessor (F237)
 * shipped as its only, hardcoded scale -- kept as the default so an
 * existing bookmarked/shared `?month=...` URL with no `zoom` param
 * renders identically to before this feature landed. */
export const DEFAULT_TIMELINE_ZOOM: TimelineZoomLevel = "month";

/** Pixels-per-day at each zoom level. "month" is `DEFAULT_PIXELS_PER_DAY`
 * unchanged (F237/F238/F239's own tests and the existing default export
 * stay valid at the default zoom); "week" is more pixels/day (a wider,
 * more legible day-granularity bar); "quarter" is fewer pixels/day (a
 * denser view covering a wider date range in the same header width). */
export const PIXELS_PER_DAY_BY_ZOOM: Record<TimelineZoomLevel, number> = {
  week: 64,
  month: DEFAULT_PIXELS_PER_DAY,
  quarter: 12,
};

/**
 * A stale/tampered/unknown `?zoom=` URL value degrades gracefully to
 * `DEFAULT_TIMELINE_ZOOM` -- same "drop rather than apply, never throw"
 * posture as `lib/calendar/resolve-filters.ts`'s `resolveCalendarFilters`
 * and `lib/views/resolve-view.ts`'s `resolveListViewFilters` (AS-448 /
 * AS-433's own precedent for this codebase).
 */
export function resolveTimelineZoom(value: string | null | undefined): TimelineZoomLevel {
  if (value === "week" || value === "month" || value === "quarter") {
    return value;
  }
  return DEFAULT_TIMELINE_ZOOM;
}

/**
 * The visible `[start, end]` window for a given zoom level, anchored on
 * the SAME `year`/`month` "?month=YYYY-MM" URL key `timelineRangeForMonth`
 * already uses -- so switching zoom levels never moves the anchor month,
 * which is exactly what "preserve the centre date across zoom changes"
 * (this feature's own Notes) requires: the anchor is the centre, and it
 * is untouched by this function, only the window WIDTH around it varies.
 *
 *   - "week": the anchor month alone (no month-before/-after padding) --
 *     the tightest, most zoomed-in window, paired with `PIXELS_PER_DAY_
 *     BY_ZOOM.week`'s wider per-day pixel width for day-level legibility.
 *   - "month": IDENTICAL to `timelineRangeForMonth` (the month before,
 *     the anchor month, the month after) -- this feature's own predecessor
 *     behaviour, unchanged.
 *   - "quarter": six months either side of the anchor month (13 calendar
 *     months total) -- still a bounded window, not the whole workspace
 *     history, paired with `PIXELS_PER_DAY_BY_ZOOM.quarter`'s narrower
 *     per-day pixel width so the wider range still fits a reasonable
 *     rendered width.
 */
export function timelineRangeForZoom(
  year: number,
  month: number,
  zoom: TimelineZoomLevel,
): { start: DateOnly; end: DateOnly } {
  const anchor = new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));

  if (zoom === "week") {
    const rangeStartDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12, 0, 0));
    const rangeEndDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 12, 0, 0));
    return { start: formatDateOnly(rangeStartDate), end: formatDateOnly(rangeEndDate) };
  }

  if (zoom === "quarter") {
    const rangeStartDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 6, 1, 12, 0, 0));
    const rangeEndDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 7, 0, 12, 0, 0));
    return { start: formatDateOnly(rangeStartDate), end: formatDateOnly(rangeEndDate) };
  }

  return timelineRangeForMonth(year, month);
}

// F239 (AS-455): dependency connectors. Pure vertical-position and path
// maths, kept in this file per the feature spec's own "Files" list --
// mirrors every other function above's "pure, side-effect-free, takes
// its inputs as plain values" shape. `components/timeline/dependency-
// overlay.tsx` is the one caller; `components/timeline/timeline-body.tsx`
// supplies the `groups`/row order it already renders from, so there is
// exactly one place row order is decided (this file never re-sorts or
// re-groups tasks itself).

/** Every task row's fixed height, in px -- matches
 * `TimelineRowTrack`'s own `h-12` Tailwind class (3rem = 48px). Kept as
 * an exported constant so the connector maths below and the row's own
 * markup can never drift out of sync with each other. */
export const TIMELINE_ROW_HEIGHT_PX = 48;

/** Each project group's header row height, in px -- `TimelineBody`'s own
 * group-header row is pinned to this fixed height (see that file) so
 * connector vertical positions can be computed purely, without measuring
 * the DOM. */
export const TIMELINE_GROUP_HEADER_HEIGHT_PX = 40;

/** The sticky task-name column's own width, in px -- matches the `w-56`
 * Tailwind class (14rem = 224px) `TimelineBody`/`TimelineScale` both use
 * for their sticky/spacer column, so the dependency overlay's SVG can be
 * offset to start exactly where the scrollable date area starts. */
export const TIMELINE_NAME_COLUMN_WIDTH_PX = 224;

export type TimelineRowGroup = { tasks: { id: string }[] };

/**
 * The vertical top offset, in px, of every rendered task row, in the
 * SAME document order `TimelineBody` renders groups/tasks in -- one
 * project-header-height per group, then one row-height per task within
 * it. A task that isn't in any group (filtered out, e.g. not
 * `isPlaceableOnTimeline`, or not visible to the caller at all) simply
 * has no entry -- callers treat a missing id as "no known row position",
 * never as row 0.
 */
export function computeTimelineRowPositions(
  groups: TimelineRowGroup[],
): Map<string, number> {
  const positions = new Map<string, number>();
  let cursor = 0;
  for (const group of groups) {
    cursor += TIMELINE_GROUP_HEADER_HEIGHT_PX;
    for (const task of group.tasks) {
      positions.set(task.id, cursor);
      cursor += TIMELINE_ROW_HEIGHT_PX;
    }
  }
  return positions;
}

/** The date-area's own total content height, in px -- the dependency
 * overlay SVG's own `height`, so it always exactly covers every rendered
 * row and never clips or over-extends. */
export function timelineBodyTotalHeightPx(groups: TimelineRowGroup[]): number {
  return groups.reduce(
    (sum, group) =>
      sum + TIMELINE_GROUP_HEADER_HEIGHT_PX + group.tasks.length * TIMELINE_ROW_HEIGHT_PX,
    0,
  );
}

export type TimelineDependencyEdgeInput = {
  id: string;
  blockingTaskId: string;
  blockedTaskId: string;
};

export type TimelineDependencyConnector = {
  id: string;
  /** SVG `path` `d` attribute -- a three-segment elbow from the blocking
   * bar's trailing edge to the blocked bar's leading edge. */
  d: string;
};

/**
 * Real connector geometry for every dependency edge whose BOTH endpoints
 * have a known row position and bar layout -- an edge with either
 * endpoint missing (not currently rendered: excluded by
 * `isPlaceableOnTimeline`, outside the visible range, or -- the sharp
 * edge this feature exists to get right -- in a project the caller
 * cannot see) is silently OMITTED, never drawn toward a guessed
 * position and never drawn as a stub that would itself confirm the
 * other task's existence. See this feature's handoff
 * AUTONOMOUS_DECISION for why "omit" was chosen over "anonymous stub".
 */
export function computeDependencyConnectors(
  edges: TimelineDependencyEdgeInput[],
  rowPositions: Map<string, number>,
  barLefts: Map<string, TimelineBarLayout>,
): TimelineDependencyConnector[] {
  const connectors: TimelineDependencyConnector[] = [];

  for (const edge of edges) {
    const blockingTop = rowPositions.get(edge.blockingTaskId);
    const blockedTop = rowPositions.get(edge.blockedTaskId);
    const blockingBar = barLefts.get(edge.blockingTaskId);
    const blockedBar = barLefts.get(edge.blockedTaskId);

    if (
      blockingTop === undefined ||
      blockedTop === undefined ||
      !blockingBar ||
      !blockedBar
    ) {
      continue;
    }

    const y1 = blockingTop + TIMELINE_ROW_HEIGHT_PX / 2;
    const y2 = blockedTop + TIMELINE_ROW_HEIGHT_PX / 2;

    // Range bars connect from their trailing (right) edge; markers are
    // centred on their single day (matching `TimelineBar`'s own
    // `-translate-x-1/2` marker rendering), so a marker's own anchor is
    // its `leftPx` unchanged.
    const x1 =
      blockingBar.kind === "range"
        ? blockingBar.leftPx + blockingBar.widthPx
        : blockingBar.leftPx;
    const x2 = blockedBar.leftPx;

    const midX = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;

    connectors.push({ id: edge.id, d });
  }

  return connectors;
}
