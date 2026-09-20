// Timezone contract: all timestamps must be UTC (Z-suffix). This helper
// clips to UTC 08:00-16:00 Mon-Fri; callers are responsible for converting
// wall-clock hours to UTC before calling. Offset-less ISO strings are
// treated as UTC.

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Matches an explicit UTC/offset marker at the end of an ISO-ish timestamp:
// "Z"/"z", or a numeric offset with or without a colon, e.g. "+00:00",
// "+02:00", "-05:00", "+0000". Deliberately requires two offset digits so it
// doesn't false-match on things like a bare "-05" date fragment.
const EXPLICIT_OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function toUtcMs(s: string): number {
  // Normalise: accept space separator, then only append a trailing "Z" when
  // the string has no explicit UTC/offset marker. Offset-less and
  // space-separated strings are treated as UTC; everything else (Z suffix,
  // "+00:00", "+02:00", "-05:00", with or without microseconds) is parsed
  // as-is so Date correctly honours the offset.
  const withT = s.replace(" ", "T");
  const normalised = EXPLICIT_OFFSET_RE.test(withT) ? withT : withT + "Z";
  return new Date(normalised).getTime();
}

/**
 * Clips a calendar block to the stacked layout's visible window: Monday-Friday,
 * 08:00-16:00 UTC. Returns one segment per Mon-Fri UTC day the block overlaps,
 * in chronological order. Returns an empty array when the block has no
 * overlap with that window.
 */
export function clipBlockToStackedWindow(
  block: StackedBlockInput
): StackedBlockClipped[] {
  const start = new Date(toUtcMs(block.starts_at));
  const end = new Date(toUtcMs(block.ends_at));

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }
  if (end.getTime() <= start.getTime()) {
    return [];
  }

  const segments: StackedBlockClipped[] = [];

  const firstDayStart = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const lastDayStart = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );

  for (
    let dayMs = firstDayStart;
    dayMs <= lastDayStart;
    dayMs += MS_PER_DAY
  ) {
    const day = new Date(dayMs);
    const utcDay = day.getUTCDay(); // 0 = Sunday .. 6 = Saturday
    const isoWeekday = utcDay === 0 ? 7 : utcDay;

    if (!(STACKED_DAYS as readonly number[]).includes(isoWeekday)) {
      continue;
    }

    const windowStart = new Date(
      Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        STACKED_START_HOUR,
        0,
        0,
        0
      )
    );
    const windowEnd = new Date(
      Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        STACKED_END_HOUR,
        0,
        0,
        0
      )
    );

    const segStart = start.getTime() > windowStart.getTime() ? start : windowStart;
    const segEnd = end.getTime() < windowEnd.getTime() ? end : windowEnd;

    if (segStart.getTime() < segEnd.getTime()) {
      segments.push({
        starts_at: segStart.toISOString(),
        ends_at: segEnd.toISOString(),
      });
    }
  }

  return segments;
}
