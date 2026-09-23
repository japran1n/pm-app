// F124 (AS-207): pure, side-effect-free timezone-aware date helpers built on
// date-fns + Intl (no new date library, per tech-decisions.md's "date-fns —
// all calendar, timeline, recurrence, and timezone maths. No new date
// library."). Every function takes the caller's IANA timezone as an
// explicit argument — never read from a global, from
// `Intl.DateTimeFormat().resolvedOptions().timeZone`, or from the process
// environment. This is the single place "what day is it, for this user"
// gets computed; lib/tasks/is-overdue.ts and every UI surface that shows
// overdue/today state (board card, list table, task detail sheet,
// dashboard tile/RPC) calls through here so they can never disagree.
//
// `due_date` (and every date-only string this module accepts) is a plain
// "YYYY-MM-DD" calendar date with no time component (see
// lib/tasks/is-overdue.ts's original F040 comment) — so the core operation
// is not "convert an instant to a zone" but "what is today's calendar date
// AS SEEN FROM this timezone, right now". `getZonedYMD` answers that via
// `Intl.DateTimeFormat`'s `formatToParts`, which is IANA-timezone-database
// aware (correct across DST transitions and historical offset changes,
// unlike a hand-rolled fixed-offset calculation).
//
// `startOfDayInTimeZone`/`endOfDayInTimeZone` go one step further and
// resolve the actual UTC instant a zone's local midnight/day-end falls on,
// for callers that need to bound a timestamp column rather than compare
// two plain calendar dates (future callers per tech-decisions.md: the
// calendar view AS-450, the digest scheduler AS-400). They use the
// standard "guess, then correct against the zone's own offset" technique
// (two iterations, to converge even across a DST boundary) that
// date-fns-tz/Luxon also use internally — implemented by hand here so no
// new dependency is needed.
//
// Failure handling (per the clarified spec): invalid input (an
// unrecognized timezone, or a malformed date-only string) returns
// null/false rather than throwing — the caller decides how to surface it,
// this module never crashes a render.

import { addDays, isBefore, parseISO } from "date-fns";

import { isDoneStatus } from "@/lib/tasks/status-category";

export type DateOnly = string; // "YYYY-MM-DD"

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True iff `timeZone` is a value the runtime's `Intl` can construct a
 * `DateTimeFormat` with. Deliberately the same construction-based check
 * lib/validation/profile.ts's own `isValidTimeZone` uses (accepts "UTC"
 * even though CLDR's `Intl.supportedValuesOf("timeZone")` list only has
 * "Etc/UTC" — see that file's comment for the verified repro) — kept as a
 * small local copy rather than an import, since this module must not
 * depend on the Zod validation layer (a pure lib/time helper importing
 * lib/validation would invert this codebase's dependency direction:
 * validation schemas depend on domain helpers, never the other way
 * around). Exported so a future caller can guard before calling the rest
 * of this module's functions, instead of re-deriving the same try/catch.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** y/m/d as seen from `timeZone` at the instant `instant` — or null if
 * `timeZone` isn't a timezone the runtime recognizes. */
function getZonedYMD(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } | null {
  if (!isValidTimeZone(timeZone)) return null;
  if (Number.isNaN(instant.getTime())) return null;

  // en-CA formats as YYYY-MM-DD, but the actual formatted *string* is
  // never read — the parts are pulled out individually so this never
  // depends on a locale's separator/field order.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  if (!year || !month || !day) return null;
  return { year, month, day };
}

/**
 * "YYYY-MM-DD" for `instant` (default: now) as seen from `timeZone` — i.e.
 * "what day is it right now, for this user". Null for an unrecognized
 * timezone. The single building block `isTodayInTimeZone`/
 * `isOverdueInTimeZone` are both built on.
 */
export function todayInTimeZone(
  timeZone: string,
  instant: Date = new Date(),
): DateOnly | null {
  const parts = getZonedYMD(instant, timeZone);
  if (!parts) return null;
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

/**
 * The UTC-instant offset (in minutes, positive = ahead of UTC) `timeZone`
 * was at during `instant`. The "format the guess, measure the drift" half
 * of the technique date-fns-tz/Luxon use internally — kept local here to
 * avoid adding either as a dependency.
 */
function getTimeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // formatToParts's "hour" can render "24" for midnight under some
  // hourCycle/ICU combinations even with hourCycle:"h23" requested —
  // normalized to 0 so the UTC.Date construction below doesn't rôll into
  // the wrong day.
  const hour = get("hour") % 24;
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return (asIfUtc - instant.getTime()) / 60000;
}

/**
 * The UTC instant (as epoch ms) at which local midnight begins for
 * (`year`, `month`, `day`) in `timeZone`. Two iterations: the first pass
 * guesses using the offset at the (wrong) UTC-anchored guess, the second
 * re-derives the offset from that corrected instant — enough to converge
 * even when the guess and the true instant fall on opposite sides of a
 * DST transition (verified against the 2026-03-08 America/New_York
 * spring-forward boundary in this module's own tests).
 */
function zonedMidnightToUtcMs(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const localAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instantMs = localAsUtc;
  for (let i = 0; i < 2; i++) {
    const offsetMinutes = getTimeZoneOffsetMinutes(
      new Date(instantMs),
      timeZone,
    );
    instantMs = localAsUtc - offsetMinutes * 60000;
  }
  return instantMs;
}

function parseDateOnly(
  dateOnly: DateOnly,
): { year: number; month: number; day: number } | null {
  if (!DATE_ONLY_PATTERN.test(dateOnly)) return null;
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * The UTC instant at which local midnight begins, for `dateOnly`
 * ("YYYY-MM-DD") in `timeZone`. Null for a malformed date string or an
 * unrecognized timezone. Resolves the real DST-aware offset for that
 * specific day (not a fixed offset) — e.g. a due date that falls exactly
 * on a DST transition day still gets the correct UTC boundary.
 */
export function startOfDayInTimeZone(
  dateOnly: DateOnly,
  timeZone: string,
): Date | null {
  if (!isValidTimeZone(timeZone)) return null;
  const parts = parseDateOnly(dateOnly);
  if (!parts) return null;

  return new Date(
    zonedMidnightToUtcMs(parts.year, parts.month, parts.day, timeZone),
  );
}

/**
 * The UTC instant at which local day-end (23:59:59.999) falls, for
 * `dateOnly` in `timeZone`. Deliberately NOT "start of day + 24h - 1ms":
 * on a DST-transition day that arithmetic over/under-shoots by the size
 * of the transition (a spring-forward day is only 23 real hours long, a
 * fall-back day is 25) because the offset changes partway through. This
 * instead independently resolves the *next* calendar day's own midnight
 * (with its own, possibly different, correct offset) and steps back 1ms —
 * `addDays` (date-fns) computes that next calendar date, kept
 * timezone-agnostic by anchoring it at UTC-noon so no DST shift on the
 * anchor date itself can roll it onto the wrong day.
 */
export function endOfDayInTimeZone(
  dateOnly: DateOnly,
  timeZone: string,
): Date | null {
  if (!isValidTimeZone(timeZone)) return null;
  const parts = parseDateOnly(dateOnly);
  if (!parts) return null;

  const anchor = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0),
  );
  const next = addDays(anchor, 1);
  const nextMidnightMs = zonedMidnightToUtcMs(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return new Date(nextMidnightMs - 1);
}

/**
 * True iff `dateOnly` is "today" as seen from `timeZone`, evaluated
 * against `instant` (default: now). False — never throws — for a
 * malformed date string or an unrecognized timezone.
 */
export function isTodayInTimeZone(
  dateOnly: DateOnly,
  timeZone: string,
  instant: Date = new Date(),
): boolean {
  if (!DATE_ONLY_PATTERN.test(dateOnly)) return false;
  const today = todayInTimeZone(timeZone, instant);
  if (!today) return false;
  return dateOnly === today;
}

/**
 * F040/F124 (AS-063, AS-064, AS-207): a task is overdue when its due date
 * is strictly before "today" AS SEEN FROM `timeZone`, and its status is
 * not "done" — "in the past" is now evaluated against the CALLER's
 * timezone instead of the server's, so the same task can be overdue for
 * one user and not-yet-due for another at the exact same instant (e.g.
 * one east of UTC past local midnight, one west of UTC not there yet).
 * Same date-only, done-excluded, null-safe rules F040 originally
 * established — only "what counts as today" changed.
 *
 * `dueDate`/`today` are compared with date-fns's `isBefore` rather than a
 * raw string comparison, so this module's actual date arithmetic goes
 * through date-fns as tech-decisions.md requires; `parseISO`'s
 * local-timezone interpretation of a date-only string doesn't affect the
 * result here because both sides are parsed identically, so the relative
 * ordering (which is all `isOverdueInTimeZone` needs) is unaffected by
 * whatever "local" happens to mean on the machine running this code.
 */
export function isOverdueInTimeZone(
  dueDate: DateOnly | null,
  status: string,
  timeZone: string,
  instant: Date = new Date(),
  statusCategory?: string | null,
): boolean {
  if (!dueDate) return false;
  // F222 (AS-410): done-ness is now decided by column CATEGORY, not the
  // literal string "done" — see lib/tasks/status-category.ts's
  // isDoneStatus for the shared rule (and its status_id-null fallback,
  // which this call preserves when `statusCategory` isn't passed).
  if (isDoneStatus(status, statusCategory)) return false;
  if (!DATE_ONLY_PATTERN.test(dueDate)) return false;

  const today = todayInTimeZone(timeZone, instant);
  if (!today) return false;

  const dueDateParsed = parseISO(dueDate);
  const todayParsed = parseISO(today);
  if (
    Number.isNaN(dueDateParsed.getTime()) ||
    Number.isNaN(todayParsed.getTime())
  ) {
    return false;
  }

  return isBefore(dueDateParsed, todayParsed);
}

/**
 * F275 (AS-207): the single formatter behind every due-date display in the
 * app — replaces the two local `formatDueDate` copies that used to live in
 * components/task/task-card.tsx and components/task/task-list-table.tsx,
 * neither of which ever received a `timeZone` at all (M10 scrutiny's
 * AS-207 finding, reproduced there: `due_date "2026-08-20"` rendered
 * "Aug 19, 2026" under `TZ=America/New_York`, contradicting the very
 * `isOverdueInTimeZone`-driven badge sitting right next to it).
 *
 * `dueDate` is a plain calendar date with no time component (see this
 * module's top comment) — there is no "instant" to convert between zones,
 * so the fix is NOT "parse as a UTC instant, then reformat in the
 * viewer's zone" (`new Date(dueDate)` parses a date-only string as UTC
 * midnight; reformatting that instant in any zone west of UTC rolls it
 * back a calendar day, which is the exact bug this replaces — same wrong
 * answer whether the zone comes from the ambient runtime or is passed
 * explicitly). Instead this anchors on `startOfDayInTimeZone`: the UTC
 * instant `timeZone`'s own local midnight begins for `dueDate`, then
 * formats that SAME instant back through the SAME `timeZone`. Round-
 * tripping through one consistent zone is what guarantees the displayed
 * y/m/d always equals the stored `dueDate`, for every IANA zone (-12
 * through +14) — not just UTC. It is also fully deterministic given
 * (`dueDate`, `timeZone`) alone, with no dependency on the machine's
 * ambient zone, so server and client render identically (no hydration
 * mismatch either).
 *
 * Returns `dueDate` unchanged for a malformed date-only string or an
 * unrecognized timezone — same "never throws" convention as the rest of
 * this module.
 */
/**
 * @deprecated en-US only, with caller-supplied `options` for call sites
 * that need a shorter/longer form than TT-002/TT-003's fixed "11 Sep
 * 2026" shape. F002 adds `lib/time/format-task-date.ts`'s
 * `formatTaskDate` as the en-GB replacement for every due-date display
 * surface; F003 migrates the call sites (task-card, my-task-row,
 * activity-feed, print-summary, my-work-card, month-grid) one at a time.
 * Kept as-is here (options/locale unchanged) rather than delegating, so
 * this module's own AS-207 regression tests — which pin the exact
 * "Aug 20, 2026" / caller-options / raw-string-fallback behaviour — stay
 * green until those call sites are actually migrated.
 */
export function formatDueDate(
  dueDate: DateOnly,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
): string {
  const instant = startOfDayInTimeZone(dueDate, timeZone);
  if (!instant) return dueDate;
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(
    instant,
  );
}
