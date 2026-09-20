export const STACKED_START_HOUR = 8;
export const STACKED_END_HOUR = 16;

/** ISO weekday numbers (1 = Monday .. 7 = Sunday) that are visible in the stacked layout. */
export const STACKED_DAYS = [1, 2, 3, 4, 5] as const;

export interface StackedBlockInput {
  starts_at: string;
  ends_at: string;
}

export interface StackedBlockClipped {
  starts_at: string;
  ends_at: string;
}

/**
 * Clips a calendar block to the stacked layout's visible window: Monday-Friday,
 * 08:00-16:00. Returns null when the block has no overlap with that window.
 *
 * Times are treated as UTC — the ISO string's own date/hour components are
 * used directly, with no timezone conversion, per the clarified spec.
 */
export function clipBlockToStackedWindow(
  block: StackedBlockInput
): StackedBlockClipped | null {
  const start = new Date(block.starts_at);
  const end = new Date(block.ends_at);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  if (end.getTime() <= start.getTime()) {
    return null;
  }

  // A block must lie within a single Mon-Fri day to be eligible. If the
  // block's start day is a weekend day, or spans past the same UTC day
  // entirely outside the window, it is dropped.
  const startDay = start.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const isoWeekday = startDay === 0 ? 7 : startDay;

  if (!(STACKED_DAYS as readonly number[]).includes(isoWeekday)) {
    return null;
  }

  const dayStart = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
      STACKED_START_HOUR,
      0,
      0,
      0
    )
  );
  const dayEnd = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
      STACKED_END_HOUR,
      0,
      0,
      0
    )
  );

  const clippedStart = start.getTime() < dayStart.getTime() ? dayStart : start;
  const clippedEnd = end.getTime() > dayEnd.getTime() ? dayEnd : end;

  if (clippedStart.getTime() >= clippedEnd.getTime()) {
    return null;
  }

  return {
    starts_at: clippedStart.toISOString(),
    ends_at: clippedEnd.toISOString(),
  };
}
