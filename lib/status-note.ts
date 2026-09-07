// Pure helper: whether a workspace member's status note is still active
// (i.e. should be shown), given today's date. Kept dependency-free and
// unit-testable in isolation, mirroring lib/calendar/block-datetime.ts's
// own "pure planning step" convention.
//
// A note with no `until` date never expires. A note whose `until` date
// has already passed (strictly before "today", in the caller's own
// timezone-independent DateOnly comparison) is no longer active -- "today"
// itself still counts (the member is still out through the end of that
// day).

export function isStatusNoteActive(
  note: string | null | undefined,
  until: string | null | undefined,
  todayDateOnly: string = new Date().toISOString().slice(0, 10),
): boolean {
  if (!note || !note.trim()) return false;
  if (!until) return true;
  return until >= todayDateOnly;
}
