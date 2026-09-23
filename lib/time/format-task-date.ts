// F275/F002 (TT-002, TT-003, TT-004): the shared "how does a due date read
// on screen" formatter. en-GB day-month-year order, short month
// abbreviation, full year, no comma — "11 Sep 2026" — replacing the
// en-US "Sep 14, 2026" strings TT-003 retires from list/board/My
// Tasks/detail surfaces (migrated call-site-by-call-site in F003; this
// module only adds the helper).
//
// `dateStr` is a plain "YYYY-MM-DD" calendar date (a Postgres `date`
// column, no time component) — same contract as every other helper in
// lib/time/user-timezone.ts. It is anchored at `tz`'s own local midnight
// via `startOfDayInTimeZone` (not `new Date(dateStr)`, which parses as UTC
// midnight and can roll back a calendar day once reformatted west of
// UTC — the exact AS-207 bug this module's sibling `formatDueDate`
// exists to avoid) and then re-formatted through that same `tz`, so the
// displayed day always matches the stored calendar date for every zone.
//
// Never throws: a malformed date-only string or an unrecognized
// timezone falls back to echoing `dateStr` unchanged, same "never
// crashes a render" convention every other helper in this module family
// uses.
import { startOfDayInTimeZone } from "@/lib/time/user-timezone";

export function formatTaskDate(
  dateStr: string | null,
  tz: string = "UTC",
): string {
  if (!dateStr) return "No due date";

  const instant = startOfDayInTimeZone(dateStr, tz);
  if (!instant) return dateStr;

  // en-GB's short-month abbreviation renders "Sept" for September (Intl's
  // CLDR data), not the 3-letter "Sep" TT-002 pins ("11 Sep 2026") — the
  // same 3-letter form date-fns's "MMM" token produces. `en-US` is used
  // purely to source 3-letter month abbreviations (never "Sept"); the
  // day-month-year *order* and the missing comma are what actually make
  // this en-GB-shaped, and both are set explicitly below rather than
  // left to the locale's own field order.
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: tz,
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const day = get("day");
  const month = get("month");
  const year = get("year");
  if (!day || !month || !year) return dateStr;

  return `${day} ${month} ${year}`;
}
