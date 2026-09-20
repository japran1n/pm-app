// Week view: pure, side-effect-free date maths for the calendar week view,
// following the exact conventions lib/calendar/month-grid.ts already
// established for the month grid (Monday-start weeks, UTC-anchored `Date`
// arithmetic so the runtime's ambient local timezone never leaks in,
// "isToday" resolved from the caller's own IANA timezone via
// `todayInTimeZone`).
//
// This is a genuinely new view (not a re-render of the month grid at a
// narrower range) -- see components/calendar/week-time-grid.tsx for the
// vertical time-axis rendering this module's day list feeds.

import { addDays, endOfWeek, format, startOfWeek, subDays } from "date-fns";

import { todayInTimeZone, type DateOnly } from "@/lib/time/user-timezone";
import { CALENDAR_WEEK_STARTS_ON } from "@/lib/calendar/month-grid";

export type CalendarWeekDay = {
  /** "YYYY-MM-DD" */
  date: DateOnly;
  isToday: boolean;
  /** F024: which member's column this is, for the eventual M7 stacked
   * layout where multiple people's rows share one grid. Undefined in
   * today's single-column-per-day view, where `WeekTimeGrid` falls back
   * to treating every column as the signed-in member's own. */
  userId?: string;
};

export type CalendarWeek = {
  /** "YYYY-MM-DD" of the Monday this week starts on -- the canonical
   * URL-shareable key (mirrors month-grid.ts's own "?month=" convention). */
  weekKey: DateOnly;
  days: CalendarWeekDay[];
};

const WEEK_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a "?week=YYYY-MM-DD" URL search param (any date, not necessarily
 * a Monday -- resolved onto that week's own Monday by `buildCalendarWeek`)
 * into a DateOnly, or null if malformed -- same "bad URL falls back to
 * today, never crashes" convention as month-grid.ts's `parseMonthKey`.
 */
export function parseWeekKey(weekKey: string | undefined): DateOnly | null {
  if (!weekKey || !WEEK_KEY_PATTERN.test(weekKey)) return null;
  // Validate it's a real calendar date, not just date-shaped digits.
  const [year, month, day] = weekKey.split("-").map((part) => Number.parseInt(part, 10));
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return weekKey as DateOnly;
}

/** "YYYY-MM-DD" for the Monday of the week containing `dateOnly`. */
export function toWeekKey(dateOnly: DateOnly): DateOnly {
  const [year, month, day] = dateOnly.split("-").map((part) => Number.parseInt(part, 10));
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const monday = startOfWeek(anchor, { weekStartsOn: CALENDAR_WEEK_STARTS_ON });
  return format(monday, "yyyy-MM-dd") as DateOnly;
}

/** The week (Monday) containing "today" in the caller's timezone -- same
 * "resolve once, thread down" convention as month-grid.ts's
 * `currentMonthKey`. Falls back to the instant's own UTC calendar date for
 * an unrecognized timezone, never throws. */
export function currentWeekKey(timeZone: string, instant: Date = new Date()): DateOnly {
  const today = todayInTimeZone(timeZone, instant);
  if (today) {
    return toWeekKey(today as DateOnly);
  }
  const fallback = format(instant, "yyyy-MM-dd") as DateOnly;
  return toWeekKey(fallback);
}

export function previousWeekKey(weekKey: DateOnly): DateOnly {
  const [year, month, day] = weekKey.split("-").map((part) => Number.parseInt(part, 10));
  const monday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return format(subDays(monday, 7), "yyyy-MM-dd") as DateOnly;
}

export function nextWeekKey(weekKey: DateOnly): DateOnly {
  const [year, month, day] = weekKey.split("-").map((part) => Number.parseInt(part, 10));
  const monday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return format(addDays(monday, 7), "yyyy-MM-dd") as DateOnly;
}

/**
 * Builds the 7-day (Monday-start) week containing `weekKey` (any date in
 * the week -- resolved onto that week's own Monday first), with each
 * day's "isToday" flag evaluated against `timeZone`, exactly mirroring
 * `buildCalendarMonth`'s own UTC-noon-anchored day stepping so a DST
 * transition can never skip or repeat a day.
 */
export function buildCalendarWeek(
  weekKey: DateOnly,
  timeZone: string,
  instant: Date = new Date(),
): CalendarWeek {
  const monday = toWeekKey(weekKey);
  const [year, month, day] = monday.split("-").map((part) => Number.parseInt(part, 10));
  const mondayAnchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const sundayAnchor = endOfWeek(mondayAnchor, { weekStartsOn: CALENDAR_WEEK_STARTS_ON });

  const today = todayInTimeZone(timeZone, instant);

  const days: CalendarWeekDay[] = [];
  let cursor = new Date(mondayAnchor.getTime());
  while (cursor.getTime() <= sundayAnchor.getTime()) {
    const dateOnly = format(cursor, "yyyy-MM-dd") as DateOnly;
    days.push({
      date: dateOnly,
      isToday: today !== null && dateOnly === today,
    });
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return { weekKey: monday, days };
}

/** The half-open ISO-date range [start, endExclusiveDateOnly] the week's
 * days span -- same "inclusive DateOnly start/end" shape month-grid.ts's
 * own `monthDateRange` returns, for callers that bound a task/block query
 * by this window. */
export function weekDateRange(weekKey: DateOnly): { start: DateOnly; end: DateOnly } {
  const week = buildCalendarWeek(weekKey, "UTC");
  return { start: week.days[0]!.date, end: week.days[week.days.length - 1]!.date };
}

// F088: lifted out of week-view.tsx so the shared Planner header (now
// rendered once in page.tsx, above both the "week-grid" and "stacked"
// layout branches) can format the same "Jun 1 – Jun 7, 2026" label
// WeekView used to compute for itself.
export function formatWeekRangeLabel(week: CalendarWeek): string {
  const first = week.days[0]!.date;
  const last = week.days[week.days.length - 1]!.date;
  const format = (dateOnly: DateOnly) => {
    const [year, month, day] = dateOnly.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };
  const yearLabel = first.slice(0, 4);
  return `${format(first)} – ${format(last)}, ${yearLabel}`;
}
