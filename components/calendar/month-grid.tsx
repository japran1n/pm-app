// F232 (AS-442, AS-443, AS-450): the CSS-grid month view -- one cell per
// day (Monday-start weeks, leading/trailing days from adjacent months
// included, per lib/calendar/month-grid.ts), tasks bucketed into their
// due-date cell. Server Component (data already resolved by the caller
// page into typed props, per the clarified "server-fetched ... passed
// down as typed props" data-shape answer) -- month navigation (AS-443) is
// plain `<Link>`s that flip the "?month=" URL search param, so no client
// boundary is needed for this feature's own scope. F234's drag-reschedule
// is the one interaction that will need a client wrapper around the grid
// body; this component is structured (day cells as a flat mapped list, one
// task array per day) so F234 can drop a "use client" wrapper around just
// the grid body without restructuring this file.

import Link from "next/link";

import type { CalendarMonth } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import { DayCell } from "@/components/calendar/day-cell";
import { Button } from "@/components/ui/button";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthGrid({
  grid,
  tasksByDate,
  workspaceSlug,
  prevHref,
  nextHref,
  todayHref,
}: {
  grid: CalendarMonth;
  tasksByDate: Map<string, CalendarTask[]>;
  workspaceSlug: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
}) {
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    // Anchored at UTC to render the label -- month/year identity, not a
    // day-level instant, so no timezone ambiguity applies here (the day
    // cells themselves already carry the timezone-correct "isToday" flag
    // computed upstream).
    timeZone: "UTC",
  }).format(new Date(Date.UTC(grid.year, grid.month - 1, 15)));

  return (
    <div className="flex flex-col gap-3" data-testid="calendar-month-grid">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold" data-testid="calendar-month-label">
          {monthLabel}
        </h1>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href={prevHref} aria-label="Previous month">
                &larr;
              </Link>
            }
          />
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={todayHref}>Today</Link>}
          />
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href={nextHref} aria-label="Next month">
                &rarr;
              </Link>
            }
          />
        </div>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-border/60 text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="border-b border-r border-border/60 px-2 py-1">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-l border-border/60">
        {grid.days.map((day) => (
          <DayCell
            key={day.date}
            day={day}
            tasks={tasksByDate.get(day.date) ?? []}
            workspaceSlug={workspaceSlug}
          />
        ))}
      </div>
    </div>
  );
}
