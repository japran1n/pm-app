import { toIsoDate } from "@/lib/format";
// Pure date-range helpers for the workspace Time report page's "Today" /
// "This week" / "This month" shortcut links
// (app/(workspace)/w/[workspaceSlug]/time/page.tsx).
//
// Kept dependency-free (no Supabase, no Next imports) so these are testable
// in isolation and reusable from the drill-down page
// (app/(workspace)/w/[workspaceSlug]/time/[userId]/page.tsx) without pulling
// in any server-only module. All ranges are inclusive on both ends, matching
// the RPCs' own `startDate`/`endDate` semantics
// (lib/queries/time-entries.ts).
//
// "This week" starts on Monday (ISO week), matching the calendar feature's
// existing week-start convention (lib/calendar/time-grid-layout.ts) rather
// than introducing a second week-start rule into the codebase.

export type PeriodShortcut = {
  key: "today" | "week" | "month";
  label: string;
  start: string;
  end: string;
};

// Monday-start ISO week: getDay() is 0 (Sun) .. 6 (Sat); shift so Monday = 0.
function startOfIsoWeek(date: Date): Date {
  const day = date.getDay();
  const diffToMonday = (day + 6) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - diffToMonday);
  return start;
}

export function getPeriodShortcuts(now: Date = new Date()): PeriodShortcut[] {
  const todayStr = toIsoDate(now);
  const weekStart = toIsoDate(startOfIsoWeek(now));
  const monthStart = toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));

  return [
    { key: "today", label: "Today", start: todayStr, end: todayStr },
    { key: "week", label: "This week", start: weekStart, end: todayStr },
    { key: "month", label: "This month", start: monthStart, end: todayStr },
  ];
}
