// F179 (AS-317, AS-318): pure, side-effect-free "rule to plain-language
// summary" helper for `tasks.recurrence` (shape frozen by F175's handoff,
// re-exported here as `RecurrenceRule` from lib/recurrence/next-date.ts —
// see that module's doc comment for the exact contract). This is the ONLY
// place in the codebase that turns a recurrence rule into user-facing
// text — the recurrence picker's live summary in the task detail sheet
// AND the task card's compact indicator both call this same function,
// per this feature's own clarified spec ("build this summary as a small
// pure function ... not inline JSX string concatenation, so it's
// independently testable").
//
// No I/O, no locale/timezone dependency: `until` is already a plain
// "YYYY-MM-DD" date-only string (lib/recurrence/next-date.ts's contract),
// formatted here with a fixed "MMM D" style via a hand-rolled formatter
// rather than `Intl.DateTimeFormat` (which would need a timezone to be
// fully correct for a date-only value) — the simpler option that adds no
// new dependency, per this feature's ambiguity-resolution answer.

import type { RecurrenceRule } from "@/lib/recurrence/next-date";

const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Formats a "YYYY-MM-DD" date-only string as "MMM D" (e.g. "Sep 30").
 * Returns `null` for a malformed input rather than throwing, matching
 * this module's overall "never throw, degrade gracefully" contract. */
function formatDateOnly(dateOnly: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTH_ABBREVIATIONS[month - 1]} ${day}`;
}

/**
 * The freq-only clause, e.g. "Every day", "Every 2 weeks", "Every month",
 * "Every 3 days".
 */
function freqClause(freq: RecurrenceRule["freq"], interval: number): string {
  switch (freq) {
    case "daily":
      return interval === 1 ? "Every day" : `Every ${interval} days`;
    case "weekly":
      return interval === 1 ? "Every week" : `Every ${interval} weeks`;
    case "monthly":
      return interval === 1 ? "Every month" : `Every ${interval} months`;
    case "every_n_days":
      // interval is the literal "N" (F175's shape) — "every 1 days" would
      // read oddly, so 1 is special-cased to "Every day" same as `daily`.
      return interval === 1 ? "Every day" : `Every ${interval} days`;
    default:
      return "Repeats";
  }
}

/**
 * Turns a `tasks.recurrence` rule into an exact, plain-language summary
 * for the user to verify what they configured (e.g. "Every 2 weeks until
 * Sep 30"). Returns `null` for no rule at all (`null`/`undefined`) — the
 * caller decides what a "no recurrence" empty state looks like, this
 * function only ever describes a REAL rule, never invents text for the
 * absence of one.
 *
 * Malformed input (missing/invalid `freq`, a non-positive/non-integer
 * `interval`) returns `null` too — same "never throw, caller decides how
 * to surface it" convention lib/recurrence/next-date.ts's
 * `nextOccurrenceDate` already established, so this function is safe to
 * call directly against whatever the DB happens to hold without a
 * separate validity check first.
 */
export function summarizeRecurrenceRule(
  rule: RecurrenceRule | null | undefined,
): string | null {
  if (!rule || typeof rule !== "object") return null;
  const { freq, interval, until } = rule;

  if (!Number.isInteger(interval) || interval <= 0) return null;
  if (
    freq !== "daily" &&
    freq !== "weekly" &&
    freq !== "monthly" &&
    freq !== "every_n_days"
  ) {
    return null;
  }

  const base = freqClause(freq, interval);

  if (!until) return base;

  const formattedUntil = formatDateOnly(until);
  if (!formattedUntil) return base; // malformed `until` — degrade to the freq clause alone

  return `${base} until ${formattedUntil}`;
}
