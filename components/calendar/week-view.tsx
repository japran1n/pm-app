// Week/Planner follow-up: the week view's own header/nav (Prev/Today/Next
// week, same Link-driven "?week=YYYY-MM-DD" URL-state pattern month-
// grid.tsx already established for "?month="), wrapping the interactive
// time-grid body (week-time-grid.tsx). Server Component -- data already
// resolved by the caller page into typed props, mirroring month-grid.tsx's
// own split.

import type { CalendarWeek } from "@/lib/calendar/week-grid";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import type { TimeOffEntry } from "@/lib/queries/time-off";
import { eachDateInRange } from "@/lib/calendar/date-utils";
import { isoToLocalDateOnly } from "@/lib/calendar/block-datetime";
import { WeekTimeGrid } from "@/components/calendar/week-time-grid";
import { WeekAgenda } from "@/components/calendar/week-agenda";
import { TimeOffDayStrip } from "@/components/calendar/time-off-day-strip";

// F088: the week label, the URL-bound people switcher, the "add time off"
// affordance, and the prev/today/next nav controls used to live here --
// they're now the shared <PlannerHeader> rendered once by page.tsx ABOVE
// the "week-grid"/"stacked" layout branch, so the switcher survives a
// switch to the stacked (2+ people) layout instead of disappearing along
// with WeekView. See components/calendar/planner-header.tsx. `prevHref`/
// `nextHref`/`todayHref`/`peopleSwitcher` are intentionally no longer
// accepted here -- callers that still know about them should pass them to
// PlannerHeader instead.

export function WeekView({
  week,
  blocks,
  timeOffEntries,
  workspaceSlug,
  workspaceId,
  currentUserId,
}: {
  week: CalendarWeek;
  blocks: CalendarBlock[];
  /** F(PTO): every PTO entry overlapping the visible week -- see
   * lib/queries/time-off.ts's own doc comment for RLS/visibility. Empty
   * array (default) means no PTO strip renders at all, so existing
   * callers/tests that don't pass this keep behaving exactly as before. */
  timeOffEntries?: TimeOffEntry[];
  workspaceSlug: string;
  workspaceId?: string;
  /** F020 (AS-046): the signed-in member's user_id, threaded straight
   * through to WeekTimeGrid/WeekAgenda so the single `isOwnBlock`
   * predicate (lib/calendar/ownership.ts) has what it needs. */
  currentUserId: string;
}) {
  const blocksByDate: Record<string, CalendarBlock[]> = {};
  for (const block of blocks) {
    const date = isoToLocalDateOnly(block.startsAt);
    blocksByDate[date] = [...(blocksByDate[date] ?? []), block];
  }

  // Bucket each PTO entry onto every DateOnly it covers (inclusive range,
  // not just its start date) so a 5-day PTO period shows a strip on each
  // of those 5 day columns, same "one row per date it touches" posture
  // blocksByDate already uses for calendar_blocks.
  const timeOffByDate: Record<string, TimeOffEntry[]> = {};
  for (const entry of timeOffEntries ?? []) {
    for (const date of eachDateInRange(entry.startDate, entry.endDate)) {
      timeOffByDate[date] = [...(timeOffByDate[date] ?? []), entry];
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="calendar-week-view">
      <div className="hidden grid-cols-[3.5rem_repeat(7,1fr)] text-xs font-medium text-muted-foreground md:grid">
        <div />
        {week.days.map((day) => (
          <div key={day.date} className="px-2 py-1 text-center font-mono">
            {formatDayHeaderLabel(day.date, day.isToday)}
          </div>
        ))}
      </div>
      {Object.keys(timeOffByDate).length > 0 && (
        <div
          className="hidden grid-cols-[3.5rem_repeat(7,1fr)] gap-px md:grid"
          data-testid="calendar-week-time-off-row"
        >
          <div />
          {week.days.map((day) => (
            <TimeOffDayStrip key={day.date} entries={timeOffByDate[day.date] ?? []} />
          ))}
        </div>
      )}
      <div className="hidden md:block">
        <WeekTimeGrid
          days={week.days}
          blocksByDate={blocksByDate}
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
        />
      </div>
      <WeekAgenda
        days={week.days}
        blocksByDate={blocksByDate}
        workspaceSlug={workspaceSlug}
        currentUserId={currentUserId}
      />
    </div>
  );
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
