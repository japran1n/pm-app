// Pure data-shaping for the workspace Time report's team heatmap
// (components/time/team-heatmap.tsx). No Supabase/Next imports so the
// bucketing math is testable in isolation from data-fetching.
//
// Input shape: one row per (person, day) with total minutes logged that
// day. The page builds this by calling `getPersonTimeDaily` once per active
// workspace member (lib/queries/time-entries.ts) — there is no single
// workspace-wide "by person AND day" RPC yet (only
// `get_workspace_time_by_person_and_project`, which groups by project, not
// day). N calls is bounded by the number of active workspace members
// already loaded on this page for the person table, so this does not
// introduce unbounded fan-out.
//
// Column bucketing: a raw day-by-day grid over a full month (up to 31
// columns) is already at the edge of legibility; anything longer collapses
// per-day cells into ISO week buckets (Monday-start, matching
// lib/time/period-shortcuts.ts) so the heatmap never grows unboundedly wide
// with the date range.
export const MAX_DAILY_COLUMNS = 31;

export type PersonDayMinutes = {
  userId: string;
  entryDate: string; // YYYY-MM-DD
  totalMinutes: number;
};

export type HeatmapColumn = {
  key: string;
  label: string;
};

export type HeatmapCell = {
  columnKey: string;
  totalMinutes: number;
};

export type HeatmapRow = {
  userId: string;
  cells: HeatmapCell[];
};

export type HeatmapGrid = {
  columns: HeatmapColumn[];
  rows: HeatmapRow[];
  maxMinutes: number;
  bucketedByWeek: boolean;
};

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (cursor <= endDate) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function isoWeekKey(dateStr: string): { key: string; label: string } {
  const date = new Date(`${dateStr}T00:00:00`);
  const day = date.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - diffToMonday);
  const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(
    monday.getDate(),
  ).padStart(2, "0")}`;
  const label = `Wk of ${monday.getMonth() + 1}/${monday.getDate()}`;
  return { key, label };
}

// Builds a person x day (or person x week, if the range is too long)
// heatmap grid. `userIds` (already-known active members) drives row order
// so members with zero logged time still get a row of empty cells rather
// than being omitted.
export function buildTeamHeatmapGrid(
  userIds: string[],
  entries: PersonDayMinutes[],
  startDate: string,
  endDate: string,
): HeatmapGrid {
  const allDates = enumerateDates(startDate, endDate);
  const bucketedByWeek = allDates.length > MAX_DAILY_COLUMNS;

  const columns: HeatmapColumn[] = [];
  const columnKeyByDate = new Map<string, string>();

  if (bucketedByWeek) {
    const seen = new Set<string>();
    for (const date of allDates) {
      const { key, label } = isoWeekKey(date);
      columnKeyByDate.set(date, key);
      if (!seen.has(key)) {
        seen.add(key);
        columns.push({ key, label });
      }
    }
  } else {
    for (const date of allDates) {
      columnKeyByDate.set(date, date);
      const d = new Date(`${date}T00:00:00`);
      columns.push({ key: date, label: `${d.getMonth() + 1}/${d.getDate()}` });
    }
  }

  const minutesByUserAndColumn = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const columnKey = columnKeyByDate.get(entry.entryDate);
    if (!columnKey) continue; // outside the requested range; ignore defensively
    if (!minutesByUserAndColumn.has(entry.userId)) {
      minutesByUserAndColumn.set(entry.userId, new Map());
    }
    const perColumn = minutesByUserAndColumn.get(entry.userId)!;
    perColumn.set(columnKey, (perColumn.get(columnKey) ?? 0) + entry.totalMinutes);
  }

  let maxMinutes = 0;
  const rows: HeatmapRow[] = userIds.map((userId) => {
    const perColumn = minutesByUserAndColumn.get(userId) ?? new Map<string, number>();
    const cells: HeatmapCell[] = columns.map((column) => {
      const totalMinutes = perColumn.get(column.key) ?? 0;
      if (totalMinutes > maxMinutes) maxMinutes = totalMinutes;
      return { columnKey: column.key, totalMinutes };
    });
    return { userId, cells };
  });

  return { columns, rows, maxMinutes, bucketedByWeek };
}
