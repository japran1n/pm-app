// F040 (AS-063, AS-064) / F124 (AS-207): pure helper shared by TaskCard and
// any other task surface (board, list, detail sheet) that needs to
// visually distinguish overdue tasks.
//
// A task is overdue when its due date is strictly in the past AND its
// status is not "done" — a completed task is never shown as overdue
// regardless of when it was due (AS-064).
//
// F124/AS-207: "in the past" is evaluated against the CALLER's IANA
// timezone (`timeZone`), not the server's local clock — "due-date and
// overdue calculations use the user's timezone, not the server's." The
// actual timezone-aware "what day is it" math now lives in
// lib/time/user-timezone.ts's `isOverdueInTimeZone`; this function is a
// thin wrapper kept at its original F040 import path so every pre-existing
// call site (board card, list table, detail sheet) only needed the extra
// `timeZone` argument added, not a new import path threaded through.
//
// `timeZone` is a required, explicit argument — never read from a global,
// `Intl.DateTimeFormat().resolvedOptions().timeZone`, or the process
// environment (tech-decisions.md's "helpers are pure" rule) — so the same
// (dueDate, status, timeZone) triple always produces the same answer
// regardless of which machine/server/browser evaluates it.
import { isOverdueInTimeZone } from "@/lib/time/user-timezone";

export function isOverdue(
  dueDate: string | null,
  status: string,
  timeZone: string,
): boolean {
  return isOverdueInTimeZone(dueDate, status, timeZone);
}
