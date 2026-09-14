// Mission 20260914-portal-simplify, F017 (M2 scrutiny design/consistency
// pass): `isApprovalPastDue` used to be copy-pasted, verbatim, into both
// `lib/portal/waiting-on-you-count.ts` and `lib/portal/build-for-you-items.ts`
// -- a classic "these two drift the next time only one gets edited" risk,
// the same shape of bug `isDeliverablePastDue`
// (`lib/queries/deliverables.ts`) already exists to prevent for
// deliverables. This is the one shared definition both files now import.
//
// `approval_requests.due_at` is a `timestamptz` (a real point in time);
// `client_deliverables.due_at` is a plain `date` (already date-only). The
// two were previously compared against a date-only `todayIso` with a raw
// string `<` — which happens to produce the right answer for "is this
// before today", but does so by accident of ISO-8601 string-prefix
// ordering, not by an intentional, documented rule, and it's the exact
// kind of implicit assumption that breaks the moment either side's format
// changes. `toUtcDateOnly` makes the rule explicit: BOTH sides of every
// past-due/same-day comparison in this codebase are truncated to their
// UTC calendar date before comparing, so a decision due at 23:00 UTC and
// a material due that same calendar date are never treated as "different
// days" by comparing full timestamps against `date`-only strings.
export function toUtcDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Shared past-due predicate for `approval_requests` rows (a `due_at` of
 * `null` is never past due — "no deadline set" is a real, common state,
 * not implicitly overdue). Every approval this predicate ever sees is
 * still open (`getOpenApprovalsForClient` only returns `state ===
 * "pending"` rows), so "has a due date, and that date's UTC calendar day
 * has passed" is the whole check. */
export function isApprovalPastDue(dueAt: string | null, todayIso: string): boolean {
  if (dueAt === null) return false;
  return toUtcDateOnly(dueAt) < todayIso;
}
