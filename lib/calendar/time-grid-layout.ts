// Week view time-grid: pure pixel<->time maths, kept dependency-free and
// unit-testable in isolation from React/DOM/mouse events, mirroring
// lib/calendar/block-datetime.ts's and lib/calendar/reschedule.ts's own
// "pure planning step, tested without the UI" convention.
//
// The grid always represents a full 00:00-24:00 day (so a block that
// starts/ends outside the "focused" 07:00-20:00 default viewport is still
// positioned correctly, just scrolled out of initial view) -- the
// "default visible window" is a pure CSS/scroll concern for the component,
// not something this module needs to know about.

export const MINUTES_PER_DAY = 24 * 60;

/** Pixel height of one hour row in the week time-grid -- the single
 * constant every top/height calculation below derives from. */
export const PX_PER_HOUR = 48;
export const PX_PER_MINUTE = PX_PER_HOUR / 60;

/** The default scrolled-into-view window, per this feature's spec
 * ("focused on working hours e.g. 07:00-20:00 default visible"). */
export const DEFAULT_VISIBLE_START_HOUR = 7;

/**
 * Minutes since local midnight for an ISO instant, in the RUNTIME's local
 * time zone (matches lib/calendar/block-datetime.ts's own
 * `isoToLocalTime` convention -- the week grid renders in the viewer's own
 * local wall-clock time, same as the month grid's block chips already do).
 */
export function minutesSinceMidnight(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Pixel `top` offset (from the grid's own 00:00 origin) and `height` for a
 * block spanning [startsAtIso, endsAtIso) on a single day column. Clamps
 * to the visible [0, MINUTES_PER_DAY] range so a block that (incorrectly)
 * spans midnight into the next day never renders with a negative height or
 * bleeds past the bottom of its own day's column -- each day column only
 * ever shows the portion of a block that falls on that calendar day.
 *
 * `dayDateOnly` is the column's own "YYYY-MM-DD" (local) -- used to clamp a
 * block that starts before this day or ends after it to that day's own
 * [00:00, 24:00) bounds.
 */
export function blockLayoutForDay(
  startsAtIso: string,
  endsAtIso: string,
  dayDateOnly: string,
): { top: number; height: number } | null {
  const start = new Date(startsAtIso);
  const end = new Date(endsAtIso);

  const dayStart = localDateOnlyToMidnight(dayDateOnly);
  const dayEnd = new Date(dayStart.getTime() + MINUTES_PER_DAY * 60_000);

  // No overlap with this day at all.
  if (end.getTime() <= dayStart.getTime() || start.getTime() >= dayEnd.getTime()) {
    return null;
  }

  const clampedStartMinutes = Math.max(0, (Math.max(start.getTime(), dayStart.getTime()) - dayStart.getTime()) / 60_000);
  const clampedEndMinutes = Math.min(
    MINUTES_PER_DAY,
    (Math.min(end.getTime(), dayEnd.getTime()) - dayStart.getTime()) / 60_000,
  );

  const durationMinutes = Math.max(0, clampedEndMinutes - clampedStartMinutes);

  return {
    top: clampedStartMinutes * PX_PER_MINUTE,
    height: Math.max(durationMinutes * PX_PER_MINUTE, PX_PER_MINUTE * 15), // never thinner than 15min-tall, for tap/click targets
  };
}

function localDateOnlyToMidnight(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

/** Snap granularity for drag-to-create/resize -- 15 minutes, matching the
 * common Google-Calendar/ClickUp convention this feature's spec names. */
export const SNAP_MINUTES = 15;

/**
 * Converts a raw pixel Y offset (from the grid's own 00:00 origin, e.g.
 * `event.clientY - gridRect.top + scrollTop`) into a snapped "HH:MM" local
 * time, clamped to the visible day. Pure -- no DOM access, just numbers.
 */
export function pixelOffsetToTime(offsetPx: number): { hours: number; minutes: number } {
  const rawMinutes = offsetPx / PX_PER_MINUTE;
  const clamped = Math.min(Math.max(rawMinutes, 0), MINUTES_PER_DAY);
  const snapped = Math.round(clamped / SNAP_MINUTES) * SNAP_MINUTES;
  const boundedSnapped = Math.min(snapped, MINUTES_PER_DAY);
  const hours = Math.floor(boundedSnapped / 60);
  const minutes = boundedSnapped % 60;
  return { hours, minutes };
}

/**
 * Given the two pixel offsets a mousedown->mouseup drag spans (in either
 * order -- the user may drag upward), returns the snapped [startTime,
 * endTime] "HH:MM" pair to seed a new block's create form, with the end
 * always strictly after the start (a drag with zero pixel delta still
 * produces the minimum SNAP_MINUTES-wide range rather than a zero-length
 * block that would fail the create form's own "end after start"
 * validation).
 */
export function dragRangeToTimes(
  offsetAPx: number,
  offsetBPx: number,
): { startTime: string; endTime: string } {
  const lowPx = Math.min(offsetAPx, offsetBPx);
  const highPx = Math.max(offsetAPx, offsetBPx);

  const start = pixelOffsetToTime(lowPx);
  let end = pixelOffsetToTime(highPx);

  const startTotal = start.hours * 60 + start.minutes;
  let endTotal = end.hours * 60 + end.minutes;
  if (endTotal <= startTotal) {
    endTotal = Math.min(startTotal + SNAP_MINUTES, MINUTES_PER_DAY);
  }
  end = { hours: Math.floor(endTotal / 60), minutes: endTotal % 60 };

  return {
    startTime: formatHHMM(start.hours, start.minutes),
    endTime: formatHHMM(end.hours, end.minutes),
  };
}

function formatHHMM(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Applies a resize-handle drag (top or bottom edge) to an existing block's
 * [startsAtIso, endsAtIso), given the new pixel offset the handle was
 * dragged to. Returns the new ISO pair with only the dragged edge moved,
 * snapped to SNAP_MINUTES and clamped so the block never inverts (the
 * dragged edge cannot cross the OTHER (fixed) edge closer than
 * SNAP_MINUTES) -- `dayDateOnly` anchors the pixel offset onto the block's
 * own calendar day (a resize never moves a block across midnight).
 */
export function applyResize(
  edge: "start" | "end",
  startsAtIso: string,
  endsAtIso: string,
  dayDateOnly: string,
  newOffsetPx: number,
): { startsAt: string; endsAt: string } {
  const dayStart = localDateOnlyToMidnight(dayDateOnly);
  const { hours, minutes } = pixelOffsetToTime(newOffsetPx);
  const candidate = new Date(dayStart.getTime() + (hours * 60 + minutes) * 60_000);

  const fixedOtherEdge = edge === "start" ? new Date(endsAtIso) : new Date(startsAtIso);
  const minGapMs = SNAP_MINUTES * 60_000;

  if (edge === "start") {
    const clamped = candidate.getTime() >= fixedOtherEdge.getTime() - minGapMs
      ? new Date(fixedOtherEdge.getTime() - minGapMs)
      : candidate;
    return { startsAt: clamped.toISOString(), endsAt: endsAtIso };
  }

  const clamped = candidate.getTime() <= fixedOtherEdge.getTime() + minGapMs
    ? new Date(fixedOtherEdge.getTime() + minGapMs)
    : candidate;
  return { startsAt: startsAtIso, endsAt: clamped.toISOString() };
}
