// F019 (missions/20260903-portal, AS-034): the burn-down series/week-math
// pure functions -- no React, no DOM, no "use client" -- extracted out of
// components/portal/hours-burndown-chart.tsx.
//
// F107 (missions/20260903-portal, docs/client-portal-visual-plan.md 2.3):
// the Overview page (a server component) needs this exact series for its
// Hours-used sparkline -- reusing it rather than adding a second query
// was the intended fix, but importing it from hours-burndown-chart.tsx
// broke Overview at request time ("Attempted to call
// computeBurndownSeries() from the server but computeBurndownSeries is on
// the client"): that file has `"use client"` at its top, so EVERY export
// from it becomes a client-reference proxy once imported into a server
// module, even a plain, DOM-free function -- calling it (not just
// importing its type) throws. Same class of defect as F069
// (lib/metrics/measurement-status.ts's own header comment), same fix:
// move the pure computation to a module with no "use client" directive
// and no client-only imports, so it can be called from both a server
// page and the client-only chart. `hours-burndown-chart.tsx` re-exports
// these names unchanged so its own existing client caller (and F019's
// own unit test, which imports them from that file) keeps working
// without a second copy.
import type { ClientHoursWeek } from "@/lib/queries/hours";

export type BurndownPoint = {
  isoWeek: string;
  /** This week's own (non-cumulative) billable minutes. */
  weekMinutes: number;
  /** Cumulative billable minutes through this week (the Used line). */
  usedMinutes: number;
  /** Cumulative planned minutes through this week (the Planned line),
   * the budget spread evenly across the observed week range. */
  plannedMinutes: number;
};

/**
 * Fills the gaps `project_hours_client`'s sparse weekly array leaves
 * (a week with zero billable minutes never appears in it) so the chart
 * draws a continuous week-by-week grid, and computes the evenly-spread
 * planned cumulative for each week. Exported for direct unit testing.
 */
export function computeBurndownSeries(
  weekly: ClientHoursWeek[],
  soldMinutes: number | null,
  todayIso: string,
): BurndownPoint[] {
  if (weekly.length === 0) return [];

  const sorted = [...weekly].sort((a, b) => (a.isoWeek < b.isoWeek ? -1 : 1));
  const firstWeek = sorted[0]!.isoWeek;
  const lastDataWeek = sorted[sorted.length - 1]!.isoWeek;
  const todayWeek = isoWeekOf(todayIso);
  const lastWeek = lastDataWeek > todayWeek ? lastDataWeek : todayWeek;

  const allWeeks = enumerateIsoWeeks(firstWeek, lastWeek);
  const totalWeeks = allWeeks.length;

  const minutesByWeek = new Map(sorted.map((w) => [w.isoWeek, w.minutes]));

  let runningUsed = 0;
  return allWeeks.map((isoWeek, index) => {
    const weekMinutes = minutesByWeek.get(isoWeek) ?? 0;
    runningUsed += weekMinutes;
    const plannedMinutes =
      soldMinutes === null ? 0 : Math.round((soldMinutes * (index + 1)) / totalWeeks);
    return { isoWeek, weekMinutes, usedMinutes: runningUsed, plannedMinutes };
  });
}

// F111 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.6):
// exported (was module-private) so the weekly-delivery series
// (lib/portal/weekly-delivery.ts) can bucket a plain completion-date
// string into the same ISO week grid this file's own burn-down series
// uses, rather than a second, possibly-inconsistent week-math
// implementation living beside it. No behaviour change to this
// function's existing callers in this file.
export function isoWeekOf(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  return toIsoWeekString(date);
}

function toIsoWeekString(date: Date): string {
  const target = new Date(date.getTime());
  const dayNum = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const week =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday of the given ISO week ("YYYY-Www"), as a UTC Date. */
export function isoWeekToMonday(isoWeek: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!match) return new Date(NaN);
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  const week1Monday = new Date(jan4.getTime());
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
  const monday = new Date(week1Monday.getTime());
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

export function enumerateIsoWeeks(fromWeek: string, toWeek: string): string[] {
  const weeks: string[] = [];
  let cursor = isoWeekToMonday(fromWeek);
  const end = isoWeekToMonday(toWeek);
  // Guard against a malformed pair looping forever -- 520 weeks is a
  // generous 10-year ceiling, far beyond any real budget period.
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 520) {
    weeks.push(toIsoWeekString(cursor));
    cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
    guard += 1;
  }
  return weeks;
}

export function formatWeekLabel(isoWeek: string): string {
  const monday = isoWeekToMonday(isoWeek);
  if (Number.isNaN(monday.getTime())) return isoWeek;
  return monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
