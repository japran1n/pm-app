// F234 (AS-445): pure, side-effect-free planning for a calendar drag
// reschedule — the clarified "pure module under lib/, plain typed inputs,
// no I/O, no ambient timezone" pattern (same shape as
// lib/calendar/month-grid.ts and lib/my-tasks/bucket.ts). Given the
// calendar's current in-memory `Record<DateOnly, CalendarTask[]>` bucket
// (the exact structure components/calendar/month-grid.tsx already builds
// and components/calendar/calendar-day-grid.tsx keeps as client state)
// plus a dragged task id and the target cell's date, this computes the
// optimistic next bucket — or `null` when there's nothing to do (task not
// found, or dropped back on its own current day).
//
// Date correctness (this feature's core risk): `targetDate` is taken as
// an opaque "YYYY-MM-DD" string and never parsed through `new Date(...)`
// anywhere in this module — it flows straight from the caller (the
// dropped-on cell's OWN `day.date`, per lib/calendar/month-grid.ts) into
// both the returned bucket key and the `dueDate` written onto the moved
// task, so no ambient timezone can shift it by a day. This is also why a
// leading/trailing day from an adjacent month "just works": its `day.date`
// already carries that adjacent month's real date, and this module never
// second-guesses it against the grid's own displayed month/year.

import type { CalendarTask } from "@/lib/queries/calendar";
import type { DateOnly } from "@/lib/time/user-timezone";

export type ReschedulePlan = {
  /** The date the task moved FROM. */
  sourceDate: DateOnly;
  /** The date the task moved TO — identical to the `targetDate` argument. */
  targetDate: DateOnly;
  /** The moved task, with `dueDate` already updated to `targetDate`. */
  task: CalendarTask;
  /** `tasksByDate`, with the task removed from `sourceDate`'s list and
   * appended to `targetDate`'s list — every other date's list is the same
   * array reference as the input (no unnecessary copying). */
  nextTasksByDate: Record<string, CalendarTask[]>;
};

/**
 * Plans a drag-drop reschedule against an in-memory date bucket. Returns
 * `null` (never throws) when:
 *  - `taskId` isn't present in any of `tasksByDate`'s lists, or
 *  - the task's current date is already `targetDate` (a no-op drop).
 *
 * Pure: does not call `editTask`, does not touch the network/DB, does not
 * read the caller's timezone or "now" — the caller (calendar-day-grid.tsx)
 * decides how to apply the optimistic update, when to call the real
 * `editTask` Server Action, and how to roll back on failure.
 */
export function planReschedule(
  tasksByDate: Record<string, CalendarTask[]>,
  taskId: string,
  targetDate: DateOnly,
): ReschedulePlan | null {
  let sourceDate: string | null = null;
  let task: CalendarTask | null = null;

  for (const [date, tasksOnDate] of Object.entries(tasksByDate)) {
    const found = tasksOnDate.find((t) => t.id === taskId);
    if (found) {
      sourceDate = date;
      task = found;
      break;
    }
  }

  if (!task || sourceDate === null || sourceDate === targetDate) {
    return null;
  }

  const movedTask: CalendarTask = { ...task, dueDate: targetDate };

  const nextTasksByDate: Record<string, CalendarTask[]> = {
    ...tasksByDate,
    [sourceDate]: (tasksByDate[sourceDate] ?? []).filter((t) => t.id !== taskId),
    [targetDate]: [...(tasksByDate[targetDate] ?? []), movedTask],
  };

  return {
    sourceDate: sourceDate as DateOnly,
    targetDate,
    task: movedTask,
    nextTasksByDate,
  };
}
