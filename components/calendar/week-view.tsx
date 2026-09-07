// Week/Planner follow-up: the week view's own header/nav (Prev/Today/Next
// week, same Link-driven "?week=YYYY-MM-DD" URL-state pattern month-
// grid.tsx already established for "?month="), wrapping the interactive
// time-grid body (week-time-grid.tsx). Server Component -- data already
// resolved by the caller page into typed props, mirroring month-grid.tsx's
// own split.

import Link from "next/link";

import type { CalendarWeek } from "@/lib/calendar/week-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import { isoToLocalDateOnly } from "@/lib/calendar/block-datetime";
import { WeekTimeGrid } from "@/components/calendar/week-time-grid";
import { Button } from "@/components/ui/button";

export function WeekView({
  week,
  tasksByDate,
  blocks,
  workspaceSlug,
  workspaceId,
  prevHref,
  nextHref,
  todayHref,
}: {
  week: CalendarWeek;
  tasksByDate: Map<string, CalendarTask[]>;
  blocks: CalendarBlock[];
  workspaceSlug: string;
  workspaceId?: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
}) {
  const rangeLabel = formatWeekRangeLabel(week);

  const tasksByDateObject: Record<string, CalendarTask[]> = Object.fromEntries(tasksByDate);

  const blocksByDate: Record<string, CalendarBlock[]> = {};
  for (const block of blocks) {
    const date = isoToLocalDateOnly(block.startsAt);
    blocksByDate[date] = [...(blocksByDate[date] ?? []), block];
  }

  return (
    <div className="flex flex-col gap-3" data-testid="calendar-week-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold" data-testid="calendar-week-label">
          {rangeLabel}
        </h1>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href={prevHref} aria-label="Previous week">
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
              <Link href={nextHref} aria-label="Next week">
                &rarr;
              </Link>
            }
          />
        </div>
      </div>
      <div className="hidden grid-cols-[3.5rem_repeat(7,1fr)] text-xs font-medium text-muted-foreground md:grid">
        <div />
        {week.days.map((day) => (
          <div key={day.date} className="px-2 py-1 text-center">
            {formatDayHeaderLabel(day.date, day.isToday)}
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <WeekTimeGrid
          days={week.days}
          tasksByDate={tasksByDateObject}
          blocksByDate={blocksByDate}
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
        />
      </div>
      <p className="text-xs text-muted-foreground md:hidden" data-testid="calendar-week-mobile-fallback">
        The time-grid week view is available on wider screens. Rotate your
        device or use a larger screen to see this week&apos;s tasks and
        blocks here.
      </p>
    </div>
  );
}

function formatWeekRangeLabel(week: CalendarWeek): string {
  const first = week.days[0]!.date;
  const last = week.days[week.days.length - 1]!.date;
  const format = (dateOnly: string) => {
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

function formatDayHeaderLabel(dateOnly: string, isToday: boolean): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return isToday ? `${label} · Today` : label;
}
