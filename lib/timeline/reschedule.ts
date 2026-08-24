// F238 (AS-454): pure, side-effect-free planning for a timeline bar
// drag-move or edge-resize -- the exact same "pure module under lib/,
// plain typed inputs, no I/O, no ambient timezone" pattern
// lib/calendar/reschedule.ts (F234, AS-445) already established for the
// calendar's own drag-drop reschedule. No network/DB/React import here;
// the caller (components/timeline/timeline-body.tsx) decides how to
// apply the optimistic update, when to call the real `editTask` Server
// Action, and how to roll back on failure.
//
// Date correctness (this feature's own flagged top risk, same as
// F234's): every date in and out of this module is an opaque
// "YYYY-MM-DD" `DateOnly` string. Day-count arithmetic goes through
// `addDaysToDateOnly`/`diffCalendarDays` (lib/timeline/layout.ts, F237's
// own UTC-noon-anchored primitives, reused here rather than
// reimplemented) -- never `new Date(dateOnlyString)` at UTC midnight,
// never the caller's ambient timezone. A pixel delta becomes a day
// delta by simple division/rounding (see `pixelDeltaToDayDelta` below);
// nothing here ever reads `Intl.DateTimeFormat().resolvedOptions().timeZone`
// or `new Date()` with no arguments.
//
// Inversion handling (this feature's own AUTONOMOUS_DECISION, spec asks
// "decide what happens if a resize would invert the bar (clamp?
// refuse?) and document it"): a resize CLAMPS rather than refuses --
// dragging the start handle past the due date clamps the new start to
// the existing due date (a one-day bar, never inverted); dragging the
// due handle before the start date clamps the new due date to the
// existing start date, symmetrically. This guarantees the payload this
// module ever proposes can never violate
// `tasks_start_date_not_after_due_date` (F236's own DB CHECK,
// supabase/migrations/20260828010000_tasks_start_date.sql) -- the UI
// never even attempts a write the database would reject, which is what
// the spec's own "the UI must not be able to produce a rejected write"
// line requires. "Refuse" (a no-op on inversion) was rejected as the
// simpler-seeming option because it would silently swallow the user's
// drag past the boundary with no visible feedback at all, worse UX than
// snapping to the boundary; clamping still gives an unambiguous, always-
// valid result with no new dependency.
//
// Bar-move (whole-bar drag) can never invert by construction: both
// dates shift by the identical `deltaDays`, so their difference (the
// task's duration) is invariant -- no clamping is needed or performed
// for a move, only for a resize.
//
// Marker tasks (F237's own AUTONOMOUS_DECISION: a task with exactly one
// of start/due present renders as a single-day marker, AS-452): dragging
// a marker moves its one known date by `deltaDays`; there is no second
// handle to resize since there is only one date to begin with --
// `planTimelineBarResize` returns null for a marker task (see its own
// doc comment) rather than inventing a second-date behaviour AS-452
// doesn't ask for.

import type { DateOnly } from "@/lib/time/user-timezone";
import {
  addDaysToDateOnly,
  diffCalendarDays,
  type TimelineTaskDates,
} from "@/lib/timeline/layout";

export type TimelineDatePlan = {
  /** null only when the task itself has no start date (marker-on-due
   * case) -- never set to null as a result of this module's own maths. */
  startDate: DateOnly | null;
  /** null only when the task itself has no due date (marker-on-start
   * case) -- see startDate's own note. */
  dueDate: DateOnly | null;
};

/**
 * Converts a raw pointer pixel delta into a whole-day delta, rounding to
 * the nearest day so a drag that hasn't crossed half a day's width yet
 * is treated as a no-op (round-to-nearest, not floor/ceil, so dragging
 * slightly short of a full day-width still snaps to that day rather
 * than requiring a full day-width of pointer travel before anything
 * moves).
 */
export function pixelDeltaToDayDelta(deltaPx: number, pixelsPerDay: number): number {
  if (pixelsPerDay <= 0) return 0;
  return Math.round(deltaPx / pixelsPerDay);
}

/**
 * Plans a whole-bar drag (moves BOTH dates, preserving duration) or a
 * marker drag (moves the one date it has). Returns `null` (a no-op) when
 * `deltaDays` is 0 or the task has no placeable date at all -- mirrors
 * `planReschedule`'s own "same day = no-op, never call the action"
 * convention.
 */
export function planTimelineBarMove(
  task: TimelineTaskDates,
  deltaDays: number,
): TimelineDatePlan | null {
  if (deltaDays === 0) return null;

  if (task.startDate !== null && task.dueDate !== null) {
    return {
      startDate: addDaysToDateOnly(task.startDate, deltaDays),
      dueDate: addDaysToDateOnly(task.dueDate, deltaDays),
    };
  }
  if (task.dueDate !== null) {
    return { startDate: null, dueDate: addDaysToDateOnly(task.dueDate, deltaDays) };
  }
  if (task.startDate !== null) {
    return { startDate: addDaysToDateOnly(task.startDate, deltaDays), dueDate: null };
  }
  return null;
}

/**
 * Plans an edge resize -- changes ONE date, clamped so it can never
 * cross the other (see this file's own header comment for why clamping
 * was chosen over refusing). Returns `null` when the task is a marker
 * (only one date known -- there is no second edge to resize against) or
 * when the resize is a no-op (the clamped result equals the current
 * value, e.g. dragging the start handle further right than the due date
 * repeatedly -- every extra pixel clamps to the same due date, so no
 * repeat call to `editTask` is made for a drag that's already pinned).
 */
export function planTimelineBarResize(
  task: TimelineTaskDates,
  edge: "start" | "end",
  deltaDays: number,
): TimelineDatePlan | null {
  if (task.startDate === null || task.dueDate === null) return null;
  if (deltaDays === 0) return null;

  if (edge === "start") {
    const proposed = addDaysToDateOnly(task.startDate, deltaDays);
    // proposed > dueDate iff (dueDate - proposed) < 0.
    const clamped = diffCalendarDays(proposed, task.dueDate) < 0 ? task.dueDate : proposed;
    if (clamped === task.startDate) return null;
    return { startDate: clamped, dueDate: task.dueDate };
  }

  const proposed = addDaysToDateOnly(task.dueDate, deltaDays);
  // proposed < startDate iff (proposed - startDate) < 0.
  const clamped = diffCalendarDays(task.startDate, proposed) < 0 ? task.startDate : proposed;
  if (clamped === task.dueDate) return null;
  return { startDate: task.startDate, dueDate: clamped };
}
