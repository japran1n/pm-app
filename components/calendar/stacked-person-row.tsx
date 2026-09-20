// F033 (AS-018..AS-022): renders one person's 5-column Mon-Fri x 08:00-16:00
// grid for the stacked planner layout. Each block is clipped to the visible
// window via clipBlockToStackedWindow (lib/calendar/stacked-window.ts) before
// being positioned as a chip; blocks with no overlap simply produce zero
// segments and are not rendered.

import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import type { TimeOffEntry } from "@/lib/queries/time-off";
import { eachDateInRange } from "@/lib/calendar/date-utils";
import {
  clipBlockToStackedWindow,
  STACKED_DAYS,
  STACKED_START_HOUR,
  STACKED_END_HOUR,
} from "@/lib/calendar/stacked-window";
import { getCalendarBlockDisplayColor } from "@/lib/calendar/block-colors";
import { formatBlockTimeRange } from "@/lib/calendar/block-datetime";
import { TimeOffDayStrip } from "@/components/calendar/time-off-day-strip";

// Matches week-time-grid.tsx's own row height convention (2.5rem == 40px at
// the default root font size) -- used both to size the ruler's hour axis and
// to decide whether a block is tall enough to also show its time range (see
// MIN_HEIGHT_PX_FOR_TIME_LABEL below).
const HOUR_ROW_PX = 40;
const MIN_HEIGHT_PX_FOR_TIME_LABEL = 40;

const DAY_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
};

const HOURS = Array.from(
  { length: STACKED_END_HOUR - STACKED_START_HOUR },
  (_, i) => STACKED_START_HOUR + i,
);

/** Monday..Sunday (1..7) ISO weekday -> UTC Date for the given ISO week key
 * (e.g. "2026-09-14"), assumed to already be the Monday of that week. */
function dateForIsoWeekday(weekKey: string, isoWeekday: number): Date {
  const base = new Date(`${weekKey}T00:00:00Z`);
  const result = new Date(base.getTime());
  result.setUTCDate(base.getUTCDate() + (isoWeekday - 1));
  return result;
}

interface PositionedSegment {
  block: CalendarBlock;
  isoWeekday: number;
  startsAt: string;
  endsAt: string;
}

function buildSegments(
  blocks: CalendarBlock[],
  weekKey: string,
): PositionedSegment[] {
  const segments: PositionedSegment[] = [];

  for (const block of blocks) {
    const clipped = clipBlockToStackedWindow({
      starts_at: block.startsAt,
      ends_at: block.endsAt,
    });

    for (const segment of clipped) {
      const segDate = new Date(segment.starts_at);
      const utcDay = segDate.getUTCDay();
      const isoWeekday = utcDay === 0 ? 7 : utcDay;

      // Guard: only keep segments that fall on the requested week's Mon-Fri.
      // (clipBlockToStackedWindow already restricts to Mon-Fri; the weekKey
      // itself isn't used by the clip function, so this scopes segments to
      // the correct week when a block spans multiple weeks.)
      const weekDate = dateForIsoWeekday(weekKey, isoWeekday);
      const sameDay =
        weekDate.getUTCFullYear() === segDate.getUTCFullYear() &&
        weekDate.getUTCMonth() === segDate.getUTCMonth() &&
        weekDate.getUTCDate() === segDate.getUTCDate();

      if (!sameDay) continue;

      segments.push({
        block,
        isoWeekday,
        startsAt: segment.starts_at,
        endsAt: segment.ends_at,
      });
    }
  }

  return segments;
}

function percentOffset(iso: string): number {
  const d = new Date(iso);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const totalHours = STACKED_END_HOUR - STACKED_START_HOUR;
  return ((hour - STACKED_START_HOUR) / totalHours) * 100;
}

export function StackedPersonRow({
  userId,
  userLabel,
  blocks,
  timeOffEntries,
  weekKey,
}: {
  userId: string;
  userLabel?: string;
  blocks: CalendarBlock[];
  /** F034 (AS-066): this person's approved time-off entries overlapping the
   * visible week -- `?? []` (default) means no strip renders at all, so
   * existing callers/tests that don't pass this keep behaving exactly as
   * before. */
  timeOffEntries?: TimeOffEntry[];
  weekKey: string;
}) {
  const segments = buildSegments(blocks, weekKey);

  // Bucket each PTO entry onto every DateOnly it covers (inclusive range),
  // same "one row per date it touches" posture week-view.tsx already uses
  // for its own timeOffByDate map.
  const timeOffByDate: Record<string, TimeOffEntry[]> = {};
  for (const entry of timeOffEntries ?? []) {
    for (const date of eachDateInRange(entry.startDate, entry.endDate)) {
      timeOffByDate[date] = [...(timeOffByDate[date] ?? []), entry];
    }
  }
  // Only the visible Mon-Fri dates count -- an entry whose range falls
  // entirely outside this week's window buckets to dates that never match
  // one of the five rendered columns, so it must not trigger a strip.
  const visibleDateKeys = STACKED_DAYS.map((isoWeekday) =>
    dateForIsoWeekday(weekKey, isoWeekday).toISOString().slice(0, 10),
  );
  const hasTimeOff = visibleDateKeys.some(
    (dateKey) => (timeOffByDate[dateKey] ?? []).length > 0,
  );

  return (
    <div
      data-testid={`stacked-person-row-${userId}`}
      className="w-full min-h-[6rem] shrink-0"
      role="region"
      aria-label={`${userLabel ?? userId}'s schedule`}
    >
      {userLabel && (
        <div className="mb-1 text-sm font-medium">{userLabel}</div>
      )}
      {hasTimeOff && (
        // AS-066: the strip is a sibling rendered BEFORE the time-grid
        // below, never inside it -- it sits above the grid, one column
        // per Mon-Fri day, aligned to the same 5-column layout. The
        // `ml-12` spacer matches the ruler column's own `w-12` width so the
        // strip's day columns still line up with the grid's day columns
        // below despite the ruler having no counterpart row here.
        <div
          data-testid="stacked-time-off-strip"
          className="mb-1 ml-12 grid w-[calc(100%-3rem)]"
          style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
        >
          {STACKED_DAYS.map((isoWeekday) => {
            const dayDate = dateForIsoWeekday(weekKey, isoWeekday);
            const dateKey = dayDate.toISOString().slice(0, 10);
            return (
              <TimeOffDayStrip
                key={isoWeekday}
                entries={timeOffByDate[dateKey] ?? []}
              />
            );
          })}
        </div>
      )}
      <div className="flex w-full">
        {/* Time ruler: mirrors week-time-grid.tsx's left-hand hour axis
            (muted, font-mono, right-aligned "HH:00" labels) so the stacked
            layout reads identically to the single-person view. The empty
            header cell keeps the axis's hour rows aligned under each day
            column's own header row below. */}
        <div data-testid="stacked-time-ruler" className="w-12 shrink-0">
          <div className="border-b py-1 text-center text-xs text-muted-foreground">
            &nbsp;
          </div>
          <div className="relative" style={{ height: `${HOURS.length * 2.5}rem` }}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                data-testid={`stacked-ruler-hour-${hour}`}
                className="absolute left-0 right-0 -translate-y-1/2 pr-1 text-right font-mono text-[10px] text-muted-foreground"
                style={{
                  top: `${((hour - STACKED_START_HOUR) / HOURS.length) * 100}%`,
                }}
              >
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>
        </div>
        <div
          data-testid="stacked-grid"
          className="grid flex-1"
          style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
        >
          {STACKED_DAYS.map((isoWeekday) => {
            const dayDate = dateForIsoWeekday(weekKey, isoWeekday);
            const daySegments = segments.filter(
              (s) => s.isoWeekday === isoWeekday,
            );

            return (
              <div
                key={isoWeekday}
                data-testid={`stacked-day-${isoWeekday}`}
                data-day-label={DAY_LABELS[isoWeekday]}
                data-date={dayDate.toISOString().slice(0, 10)}
                className="relative border-r last:border-r-0"
              >
                <div className="border-b py-1 text-center text-xs text-muted-foreground">
                  {DAY_LABELS[isoWeekday]}
                </div>
                <div className="relative" style={{ height: `${HOURS.length * 2.5}rem` }}>
                  {HOURS.map((hour) => (
                    <div
                      key={hour}
                      data-testid={`stacked-hour-${isoWeekday}-${hour}`}
                      data-hour={hour}
                      className="absolute left-0 right-0 border-t"
                      style={{
                        top: `${((hour - STACKED_START_HOUR) / HOURS.length) * 100}%`,
                        height: `${100 / HOURS.length}%`,
                      }}
                    />
                  ))}
                  {daySegments.map((segment, idx) => {
                    const top = percentOffset(segment.startsAt);
                    const bottom = percentOffset(segment.endsAt);
                    const heightPct = Math.max(bottom - top, 0);
                    const displayColor = getCalendarBlockDisplayColor(
                      segment.block.color,
                    );
                    // AS-018/019 window is fixed at STACKED_START_HOUR..
                    // STACKED_END_HOUR, so the block's own px height is
                    // derived from the same HOUR_ROW_PX the ruler uses --
                    // tall enough blocks (>= MIN_HEIGHT_PX_FOR_TIME_LABEL)
                    // also show their time range, matching
                    // week-time-grid.tsx's WeekBlockChip; short ones show
                    // only the title to avoid unreadable overlapping text.
                    const heightPx = (heightPct / 100) * HOURS.length * HOUR_ROW_PX;
                    const showTime = heightPx >= MIN_HEIGHT_PX_FOR_TIME_LABEL;

                    return (
                      <div
                        key={`${segment.block.id}-${idx}`}
                        data-testid={`stacked-block-${segment.block.id}-${isoWeekday}`}
                        className="absolute left-0.5 right-0.5 flex flex-col overflow-hidden rounded border px-1 text-[10px]"
                        style={{
                          top: `${top}%`,
                          height: `${heightPct}%`,
                          backgroundColor: `${displayColor}1a`,
                          borderColor: displayColor,
                        }}
                        title={segment.block.title}
                      >
                        <span className="truncate font-medium">
                          {segment.block.title}
                        </span>
                        {showTime && (
                          <span
                            className="truncate text-muted-foreground"
                            data-testid={`stacked-block-time-${segment.block.id}-${isoWeekday}`}
                          >
                            {formatBlockTimeRange(
                              segment.block.startsAt,
                              segment.block.endsAt,
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
