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

function addDaysToDateOnly(value: DateOnly, days: number): DateOnly {
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
    const day = Number(date.slice(8, 10));
    ticks.push({ date, leftPx: i * pixelsPerDay, isMonthStart: day === 1 });
  }
  return ticks;
}
