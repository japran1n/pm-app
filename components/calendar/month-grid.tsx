// F232 (AS-442, AS-443, AS-450): the CSS-grid month view -- one cell per
// day (Monday-start weeks, leading/trailing days from adjacent months
// included, per lib/calendar/month-grid.ts), tasks bucketed into their
// due-date cell. Server Component (data already resolved by the caller
// page into typed props, per the clarified "server-fetched ... passed
// down as typed props" data-shape answer) -- month navigation (AS-443) is
// plain `<Link>`s that flip the "?month=" URL search param, so no client
// boundary is needed for this feature's own scope.
//
// F234 (AS-445): the grid BODY (day cells + their tasks) now renders via
// CalendarDayGrid, a "use client" wrapper around dnd-kit -- exactly the
// seam this file's own former comment anticipated ("F234 can drop a 'use
// client' wrapper around just the grid body without restructuring this
// file"). `tasksByDate` (a `Map`, not a serializable RSC prop) is
// converted to a plain object here, right before the hand-off -- the
// only change this file itself needed; the month header/nav below is
// untouched.

import Link from "next/link";

import type { CalendarMonth } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import { CalendarDayGrid } from "@/components/calendar/calendar-day-grid";
import { AgendaList } from "@/components/calendar/agenda-list";
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

  const tasksByDateObject: Record<string, CalendarTask[]> = Object.fromEntries(
    tasksByDate,
  );

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
      <div className="hidden grid-cols-7 border-l border-t border-border/60 text-xs font-medium text-muted-foreground md:grid">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="border-b border-r border-border/60 px-2 py-1">
            {label}
          </div>
        ))}
      </div>
      {/* F235 (AS-449): both trees render server-side; Tailwind's
          `md:hidden`/`hidden md:block` (768px, the same breakpoint
          components/nav/app-sidebar.tsx already uses for its own
          "phone gets a different layout" case) picks exactly one per
          viewport with no client-side viewport-detection branch. */}
      <div className="md:hidden">
        <AgendaList
          days={grid.days}
          tasksByDate={tasksByDateObject}
          workspaceSlug={workspaceSlug}
        />
      </div>
      <div className="hidden md:block">
        <CalendarDayGrid
          days={grid.days}
          tasksByDate={tasksByDateObject}
          workspaceSlug={workspaceSlug}
        />
      </div>
    </div>
  );
}
