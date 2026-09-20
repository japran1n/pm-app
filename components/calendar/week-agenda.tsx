// Phone-width week agenda: replaces the old static "use a wider screen"
// paragraph week-view.tsx used to render under `md:`. Same posture as the
// month grid's retired agenda fallback (agenda-list.tsx): a different
// component for phones, not CSS trickery on the time grid, swapped purely
// by Tailwind's `md:hidden` / `hidden md:block` pair so no client-side
// viewport JS is needed. The container keeps the historical
// `calendar-week-mobile-fallback` testid so the e2e spec stays anchored.
//
// F015 (AS-033): tasks no longer render anywhere in the Planner, including
// here -- only blocks (listed read-only with their time range; editing a
// block stays a desktop affordance).

import type { CalendarWeekDay } from "@/lib/calendar/week-grid";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import { formatBlockTimeRange } from "@/lib/calendar/block-datetime";
import { cn } from "@/lib/utils";

export function WeekAgenda({
  days,
  blocksByDate,
  workspaceSlug: _workspaceSlug,
  currentUserId: _currentUserId,
}: {
  days: CalendarWeekDay[];
  blocksByDate: Record<string, CalendarBlock[]>;
  workspaceSlug: string;
  /** F020 (AS-046): plumbing only -- see week-time-grid.tsx's identical
   * doc comment. Real usage lands in F021-F024. */
  currentUserId: string;
}) {
  const daysWithItems = days.filter((day) => (blocksByDate[day.date] ?? []).length > 0);

  return (
    <div
      className="flex flex-col gap-4 md:hidden"
      data-testid="calendar-week-mobile-fallback"
    >
      {daysWithItems.length === 0 ? (
        <p
          className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          data-testid="calendar-week-agenda-empty"
        >
          Nothing scheduled this week.
        </p>
      ) : (
        daysWithItems.map((day) => (
          <section key={day.date} data-testid={`calendar-week-agenda-day-${day.date}`}>
            <h2
              className={cn(
                "mb-1.5 font-mono text-xs font-semibold text-muted-foreground",
                day.isToday && "text-primary",
              )}
            >
              {formatAgendaDayLabel(day)}
            </h2>
            <ul className="flex flex-col gap-1.5">
              {(blocksByDate[day.date] ?? []).map((block) => (
                <li key={block.id}>
                  <AgendaBlockRow block={block} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function formatAgendaDayLabel(day: CalendarWeekDay): string {
  // UTC-anchored purely to render the label from the DateOnly, same
  // rationale as week-view.tsx's own header helpers.
  const [year, month, dayOfMonth] = day.date.split("-").map(Number);
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, dayOfMonth)));
  return day.isToday ? `${formatted} · Today` : formatted;
}

function AgendaBlockRow({ block }: { block: CalendarBlock }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 text-sm">
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {formatBlockTimeRange(block.startsAt, block.endsAt)}
      </span>
      <span className="min-w-0 flex-1 truncate">{block.title}</span>
    </div>
  );
}
