// Shared date / duration / hours formatting helpers (ARCH-003).
//
// Timezone & locale contract
// --------------------------
// * Locale is pinned to "en-GB" (en-US only for the one budget-panel
//   variant). Never pass `undefined` locale: this code renders on the
//   server and re-renders on the client, and a viewer-locale-dependent
//   format produces hydration mismatches.
// * Two timezone families exist ON PURPOSE — pick by column type:
//   - `*UTC` helpers pin timeZone:"UTC" and accept either a date-only
//     string ("2026-09-14", a genuine Postgres `date` — a calendar day
//     that must not shift with the viewer's timezone) or a full ISO
//     timestamp. Date-only input is anchored at UTC midnight.
//   - Non-UTC helpers render in the environment's local timezone and are
//     for `timestamptz` columns — real moments where local rendering is
//     the intended behavior.
// * `toIsoDate` serializes a JS Date to local-calendar "YYYY-MM-DD" for
//   query params / range boundaries; it is not a display format.
// * Duration/hours helpers are pure minute-count formatters, timezone
//   free. Three deliberate variants exist because call sites render
//   differently: formatHours ("1" / "1.5"), formatHoursFixed ("1.0"),
//   formatHoursSuffixed ("0h" / "1h" / "1.5h"), and formatDuration
//   ("1h 30m").

export { formatDuration } from "@/lib/time/format-duration";
/** "11 Sep 2026" (en-GB, full year) / "No due date" for null — TT-002. */
export { formatTaskDate } from "@/lib/time/format-task-date";

/** Date-only anchor: a bare "YYYY-MM-DD" gets a UTC-midnight time part. */
function anchorUtc(iso: string): Date {
  return new Date(iso.includes("T") ? iso : `${iso}T00:00:00Z`);
}

/** Local-calendar "YYYY-MM-DD" (for URLs / range params, not display). */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "14 Sept 2026" — en-GB, viewer-local. For `timestamptz` moments. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "14 Sept 2026" — en-GB, UTC-pinned. For `date` columns. */
export function formatDateUTC(iso: string): string {
  const date = anchorUtc(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "14 Sept" (no year) — en-GB, viewer-local. For `timestamptz` moments. */
export function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** "14 Sept" (no year) — en-GB, UTC-pinned. For `date` columns. */
export function formatDayMonthUTC(iso: string): string {
  const date = anchorUtc(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * "14 September 2026" (long month) — en-GB, UTC-midnight-anchored but
 * rendered in the local timezone (historical behavior of the portal
 * results page; prefer formatDateLongUTC for new call sites).
 */
export function formatDateLong(iso: string): string {
  const date = anchorUtc(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "14 September 2026" (long month) — en-GB, UTC-pinned. For `date` columns. */
export function formatDateLongUTC(iso: string): string {
  const date = anchorUtc(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Sep 14, 2026" — en-US, UTC-pinned. Budget panel's historical format. */
export function formatDateEnUS(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : `${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** "14 Sept, 14:05" — en-GB, viewer-local. For `timestamptz` moments. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "1" / "1.5" — bare decimal hours, integer hours without ".0". */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/** "1.0" / "1.5" — always one decimal place, no suffix (heatmap cells). */
export function formatHoursFixed(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

/** "0h" / "1h" / "1.5h" — decimal hours with an "h" suffix. */
export function formatHoursSuffixed(minutes: number): string {
  const hours = minutes / 60;
  if (minutes === 0) return "0h";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}
