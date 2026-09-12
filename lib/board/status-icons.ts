// Ad-hoc status redesign (product owner request, 2026-09-12): icon + display
// group lookup for the new 11-status default set, keyed by status NAME —
// the same "keyed by name" convention lib/task-colors.ts's legacy
// STATUS_LABELS/STATUS_COLORS already used for the old fixed four, and
// consistent with this table's existing "name is the one thing a caller
// always has" assumption (project_statuses' own unique (project_id, name)
// index).
//
// This is intentionally a DISPLAY-ONLY concern layered on top of
// `project_statuses.category` (still exactly the three DB-constrained
// values, per lib/tasks/status-category.ts — untouched) and the new
// nullable `project_statuses.display_group` column (migration
// 20261125010000_status_set_v2.sql), which is what actually lets "Done"
// and "Closed" render as two separate dropdown sections even though both
// map to the single DB category `done`.
//
// A status name that isn't one of the 11 below (e.g. a project that was
// never migrated, a custom name a PM typed in) falls back to a
// category-derived icon/group so nothing renders unlabeled.
import {
  CircleDashed,
  Clock,
  Clock3,
  Clock6,
  Clock9,
  Clock11,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

export type StatusDisplayGroup = "not_started" | "active" | "done" | "closed";

export const STATUS_GROUP_LABELS: Record<StatusDisplayGroup, string> = {
  not_started: "Not started",
  active: "Active",
  done: "Done",
  closed: "Closed",
};

// Order the four group headers render in — matches the product owner's
// reference screenshots (Linear-style: not-started statuses first, then
// active, then the two "finished" sections).
export const STATUS_GROUP_ORDER: StatusDisplayGroup[] = [
  "not_started",
  "active",
  "done",
  "closed",
];

export const STATUS_ICON_BY_NAME: Record<string, LucideIcon> = {
  Backlog: CircleDashed,
  "To Do": CircleDashed,
  Blocked: CircleDashed,
  Canceled: CircleDashed,
  "In Design": Clock3,
  "In Dev": Clock6,
  "QA by Dev": Clock9,
  "QA by Design": Clock11,
  "Awaiting Client": Clock,
  Approved: CheckCircle2,
  Completed: CheckCircle2,
};

const GROUP_BY_CATEGORY: Record<string, StatusDisplayGroup> = {
  not_started: "not_started",
  in_progress: "active",
  done: "done",
};

/** Resolves the section a status renders under in the status dropdown.
 * Prefers the explicit `display_group` column (the only way "Done" and
 * "Closed" can be told apart, since both share DB category `done`);
 * falls back to a category-derived group for any status row that
 * predates this column. */
export function resolveStatusGroup(
  category: string | null | undefined,
  displayGroup?: string | null,
): StatusDisplayGroup {
  if (
    displayGroup === "not_started" ||
    displayGroup === "active" ||
    displayGroup === "done" ||
    displayGroup === "closed"
  ) {
    return displayGroup;
  }
  return GROUP_BY_CATEGORY[category ?? ""] ?? "not_started";
}

export function statusIconFor(
  name: string,
  category?: string | null,
): LucideIcon {
  return (
    STATUS_ICON_BY_NAME[name] ??
    (category === "done" ? CheckCircle2 : CircleDashed)
  );
}
