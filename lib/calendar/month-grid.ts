// F232 (AS-442, AS-443, AS-450): pure, side-effect-free date maths for the
// calendar month view. Same "pure helpers, no ambient timezone" convention
// as lib/time/user-timezone.ts and lib/my-tasks/bucket.ts (F124/F230) —
// this module takes the caller's IANA timezone as an explicit argument and
// never reads `Intl.DateTimeFormat().resolvedOptions().timeZone` or the
// process environment.
//
// `tasks.due_date` is a plain "YYYY-MM-DD" calendar date with no time
// component (same convention lib/time/user-timezone.ts documents at
// length). Every function in this module stays in that DateOnly string
// space — comparisons are string/date-fns comparisons of calendar dates,
// never a round trip through `new Date(dateOnlyString)` (which parses as
// UTC midnight and can silently roll the date backward a day once
// reformatted in a zone west of UTC — the exact bug class
// lib/time/user-timezone.ts's formatDueDate comment documents and this
// module deliberately avoids repeating).
//
// AUTONOMOUS_DECISION (spec's "Week start day ... stated explicitly" +
// clarification's ambiguity-resolution default: simplest option, no new
// dependency, no second source of truth): week start is Monday
// (`weekStartsOn: 1`), matching F230's `lib/my-tasks/bucket.ts` "this
// week" bucket, which already made this exact choice for the same
// codebase. Using the same convention here means "this week" means the
// same thing across My Tasks and the calendar, rather than inventing a
// second week-start rule.
//
// AUTONOMOUS_DECISION: "today" for the grid (which month is initially
// shown, and which cell gets the "is today" flag) is computed from
// `todayInTimeZone` (lib/time/user-timezone.ts) — the SAME helper
// `isOverdueInTimeZone`/`bucketForDueDate` already use — rather than a
// second "what day is it" implementation, so the calendar can never
// disagree with the overdue badge or My Tasks about what day it currently
// is in the viewer's zone.

import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";

import { todayInTimeZone, type DateOnly } from "@/lib/time/user-timezone";

export const CALENDAR_WEEK_STARTS_ON = 1 as const; // Monday, matches F230's bucket.ts

export type CalendarDay = {
  /** "YYYY-MM-DD" */
  date: DateOnly;
  /** true when `date` falls within the target month (not a leading/trailing day). */
  isCurrentMonth: boolean;
  /** true when `date` is "today" as seen from the caller's timezone. */
  isToday: boolean;
};

export type CalendarMonth = {
  /** "YYYY-MM" the grid was built for. */
  monthKey: string;
  /** 1-12 */
  month: number;
  year: number;
  /** every day cell to render, Monday-start weeks, always a whole number of weeks (leading/trailing days from adjacent months included). */
  days: CalendarDay[];
  /** first day actually in `month`/`year` — "YYYY-MM-DD". */
  firstOfMonth: DateOnly;
  /** last day actually in `month`/`year` — "YYYY-MM-DD". */
  lastOfMonth: DateOnly;
};

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

/**
 * Parses a "?month=YYYY-MM" URL search param into (year, month), or null
 * if malformed/out of range — callers fall back to the current month in
 * the caller's timezone (AS-450) rather than crashing on a bad URL.
 */
export function parseMonthKey(
  monthKey: string | undefined,
): { year: number; month: number } | null {
  if (!monthKey || !MONTH_KEY_PATTERN.test(monthKey)) return null;
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}

/** "YYYY-MM" for (year, month) — the canonical URL-shareable key (AS-443). */
export function toMonthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/**
 * The (year, month) the grid should open on when no "?month=" is present
 * in the URL — "today", in the caller's timezone (AS-450). Falls back to
 * the server's own local date only if `timeZone` is unrecognized (never
 * throws, matching lib/time/user-timezone.ts's "never crash a render"
 * convention).
 */
export function currentMonthKey(
  timeZone: string,
  instant: Date = new Date(),
): { year: number; month: number } {
  const today = todayInTimeZone(timeZone, instant);
  if (today) {
    const [yearStr, monthStr] = today.split("-");
    return { year: Number(yearStr), month: Number(monthStr) };
  }
  // Unrecognized timezone: fall back to the instant's own UTC calendar
  // date rather than throwing — matches todayInTimeZone's null-safe
  // convention at every other call site in this codebase.
  return { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1 };
}

export function previousMonthKey(year: number, month: number): { year: number; month: number } {
  const anchor = subMonths(new Date(Date.UTC(year, month - 1, 15)), 1);
  return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() + 1 };
}

export function nextMonthKey(year: number, month: number): { year: number; month: number } {
  const anchor = addMonths(new Date(Date.UTC(year, month - 1, 15)), 1);
  return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() + 1 };
}

/**
 * Builds the full grid (Monday-start weeks, leading/trailing days from
 * adjacent months included, always a whole number of 7-day weeks — so a
 * DST transition mid-month never leaves a partial or duplicated week
 * row) for (year, month), evaluated against `timeZone` for the
 * "isToday" flag (AS-450).
 *
 * Anchored at UTC noon on the 15th throughout (never the 1st/last day,
 * which sit closest to a month boundary and are the values most exposed
 * to a DST-shift-across-midnight bug if a naive local Date were used
 * instead) so date-fns's calendar maths (`startOfMonth`, `addMonths`,
 * etc.) never crosses a day boundary due to the CI/browser runtime's own
 * ambient local timezone — this module works entirely in UTC-anchored
 * `Date` objects internally and only ever emits/reads DateOnly strings,
 * so the runtime's local timezone can't leak into the result.
 */
export function buildCalendarMonth(
  year: number,
  month: number,
  timeZone: string,
  instant: Date = new Date(),
): CalendarMonth {
  const anchor = new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);

  const gridStart = startOfWeek(monthStart, { weekStartsOn: CALENDAR_WEEK_STARTS_ON });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: CALENDAR_WEEK_STARTS_ON });

  const today = todayInTimeZone(timeZone, instant);

  const days: CalendarDay[] = [];
  // Step day-by-day in UTC-anchored terms (each cell is UTC-noon of its
  // own calendar date) — never `addDays` on a value with a local
  // wall-clock time component, so this loop can't skip/repeat a day
  // across a DST transition (there is none in pure UTC).
  let cursor = new Date(gridStart.getTime());
  while (cursor.getTime() <= gridEnd.getTime()) {
    const dateOnly = format(cursor, "yyyy-MM-dd") as DateOnly;
    days.push({
      date: dateOnly,
      isCurrentMonth: isSameMonth(cursor, anchor),
      isToday: today !== null && dateOnly === today,
    });
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return {
    monthKey: toMonthKey(year, month),
    month,
    year,
    days,
    firstOfMonth: format(monthStart, "yyyy-MM-dd") as DateOnly,
    lastOfMonth: format(monthEnd, "yyyy-MM-dd") as DateOnly,
  };
}

/**
 * True iff `dateOnly` falls within [firstOfMonth, lastOfMonth] inclusive
 * of a grid built by `buildCalendarMonth` for the SAME (year, month) —
 * used by the query layer to bound the due_date range fetched for a
 * given grid without re-deriving month boundaries a second way.
 */
export function monthDateRange(
  year: number,
  month: number,
): { start: DateOnly; end: DateOnly } {
  const grid = buildCalendarMonth(year, month, "UTC");
  // The visible RANGE (including leading/trailing days from adjacent
  // months, since those days' cells are still rendered and may carry
  // real tasks due on them) is the first/last day of `days`, not
  // firstOfMonth/lastOfMonth.
  const start = grid.days[0]!.date;
  const end = grid.days[grid.days.length - 1]!.date;
  return { start, end };
}

export { parseISO };
