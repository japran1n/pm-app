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
  DEFAULT_TIMELINE_ZOOM,
  type TimelineDayTick,
  type TimelineZoomLevel,
} from "@/lib/timeline/layout";
import type { DateOnly } from "@/lib/time/user-timezone";
import { cn } from "@/lib/utils";

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function monthLabelFor(dateOnly: DateOnly): string {
  const [y, m] = dateOnly.split("-").map(Number);
  return MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(y, m - 1, 15, 12, 0, 0)));
}

function dayLabelFor(dateOnly: DateOnly): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return DAY_LABEL_FORMATTER.format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
}

function quarterLabelFor(dateOnly: DateOnly): string {
  const [y, m] = dateOnly.split("-").map(Number);
  const quarter = Math.floor((m - 1) / 3) + 1;
  return `Q${quarter} ${y}`;
}

/**
 * F240 (AS-456): the header's own tick granularity per zoom level --
 * "week" labels every day, "month" labels every month start (this
 * feature's own predecessor behaviour, unchanged), "quarter" labels
 * every quarter start, so the coarsest zoom's header stays legible
 * rather than crowding a month label into every ~12px-per-day column.
 */
function labelTicksFor(ticks: TimelineDayTick[], zoom: TimelineZoomLevel): { tick: TimelineDayTick; label: string }[] {
  if (ticks.length === 0) return [];
  if (zoom === "week") {
    return ticks.map((tick) => ({ tick, label: dayLabelFor(tick.date) }));
  }
  if (zoom === "quarter") {
    return ticks
      .filter((tick) => tick.isQuarterStart || tick === ticks[0])
      .map((tick) => ({ tick, label: quarterLabelFor(tick.date) }));
  }
  return ticks
    .filter((tick) => tick.isMonthStart || tick === ticks[0])
    .map((tick) => ({ tick, label: monthLabelFor(tick.date) }));
}

export function TimelineScale({
  rangeStart,
  rangeEnd,
  today,
  pixelsPerDay,
  zoom = DEFAULT_TIMELINE_ZOOM,
}: {
  rangeStart: DateOnly;
  rangeEnd: DateOnly;
  /** null when "today" (in the caller's timezone) falls outside the
   * visible range, or couldn't be resolved -- the today line is simply
   * omitted rather than clamped to an edge (see
   * lib/timeline/layout.ts's `todayLineOffsetPx` doc comment). */
  today: DateOnly | null;
  pixelsPerDay: number;
  /** F240 (AS-456): which header granularity to render -- defaults to
   * "month" (this feature's own predecessor's only, hardcoded scale) so
   * every existing caller/test that doesn't pass this prop keeps
   * rendering identically. */
  zoom?: TimelineZoomLevel;
}) {
  const ticks: TimelineDayTick[] = buildTimelineDayTicks(rangeStart, rangeEnd, pixelsPerDay);
  const totalWidthPx = timelineTotalWidthPx(rangeStart, rangeEnd, pixelsPerDay);
  const todayOffsetPx = today
    ? todayLineOffsetPx(today, rangeStart, rangeEnd, pixelsPerDay)
    : null;
  const labelTicks = labelTicksFor(ticks, zoom);

  return (
    <div
      className="relative h-10 border-b"
      style={{ width: `${totalWidthPx}px` }}
      data-testid="timeline-scale"
      data-zoom={zoom}
    >
      {labelTicks.map(({ tick, label }) => (
        <div
          key={tick.date}
          className="absolute top-0 h-full border-l pl-1 text-xs font-medium text-muted-foreground"
          style={{ left: `${tick.leftPx}px` }}
        >
          {label}
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
