// F176 (AS-323 support): pure, side-effect-free next-occurrence date maths
// for `tasks.recurrence` rules (shape frozen by F175's handoff: `{ freq:
// 'daily' | 'weekly' | 'monthly' | 'every_n_days', interval: <positive
// int>, until?: <ISO date string> }`).
//
// Per this feature's Clarified implementation (data-shape answer): plain
// typed inputs only, no I/O, no implicit globals — `timezone` is always an
// explicit argument, never read from a global or the process environment,
// matching the convention lib/time/user-timezone.ts already established.
// `fromDate`/`until`/the return value are all date-only "YYYY-MM-DD"
// strings (see that module's DateOnly type) — there is never a time
// component to reason about, only calendar dates as seen from `timezone`.
//
// Date arithmetic goes through date-fns (`addDays`, `addWeeks`,
// `addMonths`) per tech-decisions.md ("date-fns — all calendar, timeline,
// recurrence, and timezone maths. No new date library."), anchored at
// UTC-noon on the relevant calendar day so the arithmetic itself never
// crosses a DST boundary — DST only matters when this module later asks
// "what calendar date is that instant, as seen from `timezone`", which is
// answered by round-tripping through `todayInTimeZone`'s same
// `Intl.DateTimeFormat`-based, IANA-database-aware technique. This is what
// keeps a "daily" recurrence landing on the calendar-correct next day even
// when `timezone` observes a spring-forward/fall-back transition between
// `fromDate` and the computed next date (verified explicitly in this
// module's tests against the 2026-03-08 America/New_York spring-forward
// boundary and the 2026-11-01 fall-back boundary).
//
// Month-end handling (this feature's one open design choice, resolved per
// the clarified spec's "take the simpler option, record it" rule): CLAMP
// to the shorter month's last day rather than overflow into the next
// month. date-fns's own `addMonths` already clamps this way (Jan 31 + 1
// month -> Feb 28 in a non-leap year, Feb 29 in a leap year — never rolls
// into March), so no extra logic was needed beyond documenting and testing
// the choice explicitly.

import { addDays, addMonths, addWeeks, isAfter } from "date-fns";
import { isValidTimeZone, todayInTimeZone } from "@/lib/time/user-timezone";

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "every_n_days";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;
  until?: string | null; // "YYYY-MM-DD", optional/absent = no end date
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnlyAtUtcNoon(dateOnly: string): Date | null {
  if (!DATE_ONLY_PATTERN.test(dateOnly)) return null;
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Anchored at UTC-noon (not UTC-midnight) so date-fns's day-level
  // arithmetic (`addDays`/`addWeeks`/`addMonths`) can never roll onto the
  // adjacent calendar day due to a timezone offset applied to the anchor
  // instant itself — the exact technique
  // lib/time/user-timezone.ts's endOfDayInTimeZone comment documents for
  // the same reason.
  const instant = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (Number.isNaN(instant.getTime())) return null;
  return instant;
}

function toDateOnly(instant: Date): string {
  const y = instant.getUTCFullYear();
  const m = String(instant.getUTCMonth() + 1).padStart(2, "0");
  const d = String(instant.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Computes the next occurrence's due date from a recurrence rule.
 *
 * - `daily`: +1 day (or +`interval` days if `interval` > 1 — `interval`
 *   uniformly means "repeat every N units of `freq`" across all four
 *   freqs, per F175's shape).
 * - `weekly`: +7 days, or +`interval` weeks.
 * - `monthly`: +1 month, or +`interval` months. Month-end is CLAMPED to the
 *   target month's last day (Jan 31 + 1 month -> Feb 28/29), never
 *   overflowed into the following month.
 * - `every_n_days`: +`interval` days (interval is the literal "N").
 *
 * Returns `null` for:
 * - invalid input (malformed `fromDate`, unrecognized `timezone`, a
 *   non-positive/non-integer `interval`, or an unsupported `freq`) — per
 *   the clarified spec's failure-handling answer ("invalid input returns a
 *   typed error or null rather than throwing, and the caller decides how
 *   to surface it").
 * - a rule with an `until` date where the computed next date would fall
 *   strictly after `until` (AS-323: "no more occurrences").
 *
 * `timezone` matters only for the DST-correctness of the *comparison*
 * against `until`/"today" semantics a caller may layer on top — the day-
 * count arithmetic itself is timezone-agnostic calendar-date maths (see
 * this module's top comment). `timezone` is still required and validated
 * so a caller can never accidentally pass an unrecognized zone through
 * unnoticed.
 */
export function nextOccurrenceDate(
  rule: RecurrenceRule,
  fromDate: string,
  timezone: string,
): string | null {
  if (!isValidTimeZone(timezone)) return null;
  if (!rule || typeof rule !== "object") return null;

  const { freq, interval, until } = rule;
  if (!Number.isInteger(interval) || interval <= 0) return null;

  const from = parseDateOnlyAtUtcNoon(fromDate);
  if (!from) return null;

  let next: Date;
  switch (freq) {
    case "daily":
      next = addDays(from, interval);
      break;
    case "weekly":
      next = addWeeks(from, interval);
      break;
    case "monthly":
      // date-fns's addMonths already clamps at the shorter month's last
      // day rather than overflowing (verified explicitly in tests).
      next = addMonths(from, interval);
      break;
    case "every_n_days":
      next = addDays(from, interval);
      break;
    default:
      return null;
  }

  if (Number.isNaN(next.getTime())) return null;

  const nextDateOnly = toDateOnly(next);

  if (until) {
    const untilInstant = parseDateOnlyAtUtcNoon(until);
    if (!untilInstant) return null; // malformed `until` — invalid input
    if (isAfter(next, untilInstant)) return null; // AS-323: past `until`
  }

  return nextDateOnly;
}

/**
 * Convenience wrapper: the next occurrence date from "today" (as seen from
 * `timezone`), instead of an explicit `fromDate`. Exists for callers (a
 * scheduled job) that want "compute the next occurrence starting now"
 * without duplicating the `todayInTimeZone` call.
 */
export function nextOccurrenceDateFromToday(
  rule: RecurrenceRule,
  timezone: string,
  instant: Date = new Date(),
): string | null {
  const today = todayInTimeZone(timezone, instant);
  if (!today) return null;
  return nextOccurrenceDate(rule, today, timezone);
}
