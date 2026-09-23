// F113 (AS-171), updated by F001 (TT-001/TT-003): pure minutes -> "X hr Y min"
// formatting helper, extracted so it can be unit tested independently of any
// component and reused by both TimeTracking (task detail sheet total) and
// TaskCard's time indicator.
//
// Rules (spec examples): 90 -> "1 hr 30 min", 45 -> "45 min", 120 -> "2 hr",
// 0 -> "0 min".
//  - 0 minutes renders as "0 min" (not "0 hr 0 min") — matches the terse
//    style of other zero-state displays in this codebase.
//  - Whole hours with no remainder render as "X hr" only, no trailing "0 min".
//  - Sub-hour durations render as "Y min" only, no leading "0 hr".
//  - Negative/NaN input is defensively clamped to 0 minutes rather than
//    rendering something like "-5 min" or "NaN hr NaN min" — callers only
//    ever pass sums of positive CHECK-constrained minutes columns, but this
//    keeps the helper safe as a standalone unit under any input.
export function formatDuration(totalMinutes: number): string {
  const safeMinutes =
    Number.isFinite(totalMinutes) && totalMinutes > 0
      ? Math.round(totalMinutes)
      : 0;

  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}
