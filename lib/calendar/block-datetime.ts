// Pure helpers combining a calendar day cell's "YYYY-MM-DD" identity with
// a form's "HH:MM" local time into a real ISO instant, and back again for
// pre-filling the edit form. Kept dependency-free (no date library, same
// posture lib/calendar/month-grid.ts already takes) and unit-testable in
// isolation from React/dnd-kit/Supabase, mirroring lib/calendar/
// reschedule.ts's own "pure planning step" convention.

export function combineDateAndTime(dateOnly: string, time: string): string {
  const [hours, minutes] = time.split(":").map((part) => Number.parseInt(part, 10));
  const [year, month, day] = dateOnly.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0, 0, 0);
  return date.toISOString();
}

export function isoToLocalTime(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function isoToLocalDateOnly(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatBlockTimeRange(startsAtIso: string, endsAtIso: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return `${fmt.format(new Date(startsAtIso))}–${fmt.format(new Date(endsAtIso))}`;
}

/**
 * Re-anchors an ISO instant onto a new calendar day while preserving its
 * original local time-of-day -- used when a block is dragged from one day
 * cell to another (the block moves days, its time-of-day is untouched).
 */
export function moveIsoToDate(iso: string, newDateOnly: string): string {
  return combineDateAndTime(newDateOnly, isoToLocalTime(iso));
}
