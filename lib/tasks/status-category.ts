// F222 (AS-410): the single place "does this status count as done" is
// decided, now that board columns are per-project and their NAMES are
// caller-controlled (F219 relaxed `tasks_status_check` to admit any
// non-empty name — see supabase/migrations/20260824020000's header
// comment). A task is done because its column's CATEGORY
// (`project_statuses.category`) is `'done'`, never because its status
// text happens to spell "done" — a renamed/custom column with category
// `done` must count, and a column literally named "done-ish" whose
// category is NOT `done` must NOT count.
//
// `category` is optional/nullable on purpose: every read path in this
// codebase that already joins `project_statuses` (directly or through
// `status_id`) passes it, and this function then decides purely on
// category. The one deliberate exception is `status_id is null` — a task
// whose `status` text never matched any of this project's columns (can
// only happen for data that predates a column rename/delete since
// `sync_task_status_and_status_id` keeps both columns in sync on every
// write; see F218's migration). For that explicit edge case this falls
// back to the pre-F222 literal `status === "done"` comparison, so an
// unresolvable status_id fails toward the same "not done" mistake it
// always would have (no worse than before this feature), rather than
// silently treating an unrelated string as done. Every call site is
// expected to pass `category` when it has already fetched it — passing
// only `status` is the legacy/degraded path, not the default.
export type StatusCategory = "not_started" | "in_progress" | "done";

export function isDoneCategory(
  category: StatusCategory | string | null | undefined,
): boolean {
  return category === "done";
}

export function isDoneStatus(
  status: string,
  category?: StatusCategory | string | null,
): boolean {
  if (category !== undefined && category !== null) {
    return isDoneCategory(category);
  }
  return status === "done";
}
