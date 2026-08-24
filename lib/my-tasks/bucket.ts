// F230 (AS-436): pure bucketing logic for the My Tasks page — grouping a
// task's `due_date` into "overdue" / "today" / "this week" / "later",
// evaluated against the caller's own timezone (per F124's
// lib/time/user-timezone.ts helpers, reused here rather than a second
// date-math implementation).
//
// AUTONOMOUS_DECISION (clarification's "Bucketing runs in the user's
// timezone; 'this week' needs a defined week start" open question,
// resolved per the clarified spec's own ambiguity-resolution rule --
// "the simpler option that adds no new dependency and no second source of
// truth"): "this week" is a Monday-start ISO week (date-fns
// `weekStartsOn: 1`), computed from "today" in the caller's timezone
// through to that week's Sunday inclusive. date-fns is already this
// project's sole date library (tech-decisions.md) and already exposes
// `startOfWeek`/`endOfWeek` with an explicit `weekStartsOn`, so no new
// dependency or bespoke week-math is introduced.
//
// A second AUTONOMOUS_DECISION: bucketing is done purely by `due_date`
// comparison against "today", independent of whether the task is marked
// done -- unlike `isOverdueInTimeZone` (lib/time/user-timezone.ts), which
// deliberately excludes done tasks from the "overdue" *badge*. My Tasks
// still lists a completed task with a past due date (AS-435 says "lists
// tasks assigned to the caller", with no done-exclusion wording), just
// grouped by its actual due date rather than reclassified into "later" --
// the simpler, single-predicate rule, with no second "is this task
// actually late" definition living alongside `isOverdueInTimeZone`'s own.
// A task with no due date at all falls into "later" (third
// AUTONOMOUS_DECISION -- there is no "no date" bucket named in AS-436's
// four buckets, and "later" is the closest fit of the four named ones).

import { endOfWeek, parseISO, format } from "date-fns";

import { todayInTimeZone, type DateOnly } from "@/lib/time/user-timezone";

export type MyTasksBucket = "overdue" | "today" | "thisWeek" | "later";

export function bucketForDueDate(
  dueDate: DateOnly | null,
  timeZone: string,
  instant: Date = new Date(),
): MyTasksBucket {
  if (!dueDate) return "later";

  const today = todayInTimeZone(timeZone, instant);
  if (!today) return "later";

  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";

  const todayParsed = parseISO(today);
  const weekEnd = endOfWeek(todayParsed, { weekStartsOn: 1 });
  const weekEndYMD = format(weekEnd, "yyyy-MM-dd");

  if (dueDate <= weekEndYMD) return "thisWeek";
  return "later";
}
