// F113 (AS-171): pure minutes -> "Xh Ym" formatting helper, extracted so it
// can be unit tested independently of any component and reused by both
// TimeTracking (task detail sheet total) and TaskCard's time indicator.
//
// Rules:
//  - 0 minutes renders as "0m" (not "0h 0m") — matches the terse style of
//    other zero-state displays in this codebase.
//  - Whole hours with no remainder render as "Xh" only, no trailing "0m".
//  - Sub-hour durations render as "Ym" only, no leading "0h".
//  - Negative/NaN input is defensively clamped to 0 minutes rather than
//    rendering something like "-5m" or "NaNh NaNm" — callers only ever pass
//    sums of positive CHECK-constrained minutes columns, but this keeps the
//    helper safe as a standalone unit under any input.
export function formatDuration(totalMinutes: number): string {
  const safeMinutes =
    Number.isFinite(totalMinutes) && totalMinutes > 0
      ? Math.round(totalMinutes)
      : 0;

  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
