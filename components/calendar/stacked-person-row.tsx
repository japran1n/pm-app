// F033 (AS-018..AS-022): renders one person's 5-column Mon-Fri x 08:00-16:00
// grid for the stacked planner layout. Each block is clipped to the visible
// window via clipBlockToStackedWindow (lib/calendar/stacked-window.ts) before
// being positioned as a chip; blocks with no overlap simply produce zero
// segments and are not rendered.

import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import {
  clipBlockToStackedWindow,
  STACKED_DAYS,
  STACKED_START_HOUR,
  STACKED_END_HOUR,
} from "@/lib/calendar/stacked-window";
import { getCalendarBlockDisplayColor } from "@/lib/calendar/block-colors";

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
  weekKey,
}: {
  userId: string;
  userLabel?: string;
  blocks: CalendarBlock[];
  weekKey: string;
}) {
  const segments = buildSegments(blocks, weekKey);

  return (
    <div data-testid={`stacked-person-row-${userId}`} className="w-full">
      {userLabel && (
        <div className="mb-1 text-sm font-medium">{userLabel}</div>
      )}
      <div
        data-testid="stacked-grid"
        className="grid w-full"
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
                  const displayColor = getCalendarBlockDisplayColor(
                    segment.block.color,
                  );

                  return (
                    <div
                      key={`${segment.block.id}-${idx}`}
                      data-testid={`stacked-block-${segment.block.id}-${isoWeekday}`}
                      className="absolute left-0.5 right-0.5 overflow-hidden truncate rounded border px-1 text-[10px]"
                      style={{
                        top: `${top}%`,
                        height: `${Math.max(bottom - top, 0)}%`,
                        backgroundColor: `${displayColor}1a`,
                        borderColor: displayColor,
                      }}
                      title={segment.block.title}
                    >
                      {segment.block.title}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
