// F237 (AS-457, AS-458): the timeline's date header + today line. Server
// Component (no interaction of its own -- month/week tick labels and the
// today line are pure derived markup from typed props, per the clarified
// "server-fetched ... passed down as typed props" pattern) rendered
// INSIDE the same horizontally-scrolling container `<TimelineBar>` rows
// live in, so the header scrolls in lockstep with the bars beneath it
// rather than drifting out of alignment (AS-458: "horizontal scrolling
// does not break the layout").

import {
  buildTimelineDayTicks,
  todayLineOffsetPx,
  timelineTotalWidthPx,
  type TimelineDayTick,
} from "@/lib/timeline/layout";
import type { DateOnly } from "@/lib/time/user-timezone";
import { cn } from "@/lib/utils";

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function monthLabelFor(dateOnly: DateOnly): string {
  const [y, m] = dateOnly.split("-").map(Number);
  return MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(y, m - 1, 15, 12, 0, 0)));
}

export function TimelineScale({
  rangeStart,
  rangeEnd,
  today,
  pixelsPerDay,
}: {
  rangeStart: DateOnly;
  rangeEnd: DateOnly;
  /** null when "today" (in the caller's timezone) falls outside the
   * visible range, or couldn't be resolved -- the today line is simply
   * omitted rather than clamped to an edge (see
   * lib/timeline/layout.ts's `todayLineOffsetPx` doc comment). */
  today: DateOnly | null;
  pixelsPerDay: number;
}) {
  const ticks: TimelineDayTick[] = buildTimelineDayTicks(rangeStart, rangeEnd, pixelsPerDay);
  const totalWidthPx = timelineTotalWidthPx(rangeStart, rangeEnd, pixelsPerDay);
  const todayOffsetPx = today
    ? todayLineOffsetPx(today, rangeStart, rangeEnd, pixelsPerDay)
    : null;
  const monthStarts = ticks.filter((t) => t.isMonthStart || t === ticks[0]);

  return (
    <div
      className="relative h-10 border-b"
      style={{ width: `${totalWidthPx}px` }}
      data-testid="timeline-scale"
    >
      {monthStarts.map((tick) => (
        <div
          key={tick.date}
          className="absolute top-0 h-full border-l pl-1 text-xs font-medium text-muted-foreground"
          style={{ left: `${tick.leftPx}px` }}
        >
          {monthLabelFor(tick.date)}
        </div>
      ))}
      {todayOffsetPx !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 h-full w-px bg-destructive"
          style={{ left: `${todayOffsetPx}px` }}
          data-testid="timeline-today-line"
          aria-label={`Today: ${today}`}
        />
      ) : null}
    </div>
  );
}

/** The date-area's own content width, so row containers (which render
 * their bars absolutely-positioned) size themselves identically to the
 * scale header above them -- one source of truth for `totalWidthPx`,
 * never two independently-computed values that could drift apart. */
export function TimelineRowTrack({
  rangeStart,
  rangeEnd,
  today,
  pixelsPerDay,
  children,
  className,
}: {
  rangeStart: DateOnly;
  rangeEnd: DateOnly;
  today: DateOnly | null;
  pixelsPerDay: number;
  children: React.ReactNode;
  className?: string;
}) {
  const totalWidthPx = timelineTotalWidthPx(rangeStart, rangeEnd, pixelsPerDay);
  const todayOffsetPx = today
    ? todayLineOffsetPx(today, rangeStart, rangeEnd, pixelsPerDay)
    : null;

  return (
    <div
      className={cn("relative h-12 border-b", className)}
      style={{ width: `${totalWidthPx}px` }}
    >
      {todayOffsetPx !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 h-full w-px bg-destructive/40"
          style={{ left: `${todayOffsetPx}px` }}
        />
      ) : null}
      {children}
    </div>
  );
}
