// The single place a task status's meaning is decided. A task's semantics
// come from its board column's CATEGORY (`project_statuses.category`),
// never from its status text: a renamed/custom column with category `done`
// counts as done, and a column literally named "done" whose category is
// not `done` does not.
//
// Every read path that joins `project_statuses` passes `category`. Only
// when it is unavailable (no `status_id`) does this fall back to the known
// default names — the v2 set seeded by `seed_default_project_statuses`
// plus the pre-v2 legacy four — so a legacy "done" and a stock
// "Completed" both still count as done.
//
// `matchProjectStatusName` mirrors `public.resolve_project_status_id`
// (supabase/migrations/20261130500000_status_v2_single_source.sql), which
// the tasks sync trigger uses to turn a written status name into a
// `status_id`. Keep the two in step.
export type StatusCategory = "not_started" | "in_progress" | "done";

export const STATUS_CATEGORIES: readonly StatusCategory[] = [
  "not_started",
  "in_progress",
  "done",
];

export const LEGACY_STATUS_NAME_MAP: Readonly<Record<string, string>> = {
  todo: "To Do",
  in_progress: "In Dev",
  in_review: "QA by Dev",
  done: "Completed",
};

const DEFAULT_STATUS_CATEGORY: Readonly<Record<string, StatusCategory>> = {
  Backlog: "not_started",
  "To Do": "not_started",
  Blocked: "not_started",
  Canceled: "not_started",
  "In Design": "in_progress",
  "In Dev": "in_progress",
  "QA by Dev": "in_progress",
  "QA by Design": "in_progress",
  "Awaiting Client": "in_progress",
  Approved: "done",
  Completed: "done",
  todo: "not_started",
  in_progress: "in_progress",
  in_review: "in_progress",
  done: "done",
};

function isStatusCategory(value: unknown): value is StatusCategory {
  return value === "not_started" || value === "in_progress" || value === "done";
}

export function isDoneCategory(
  category: StatusCategory | string | null | undefined,
): boolean {
  return category === "done";
}

export function resolveStatusCategory(
  status: string | null | undefined,
  category?: StatusCategory | string | null,
): StatusCategory | null {
  if (isStatusCategory(category)) return category;
  if (!status) return null;
  return DEFAULT_STATUS_CATEGORY[status] ?? null;
}

export function isDoneStatus(
  status: string | null | undefined,
  category?: StatusCategory | string | null,
): boolean {
  return resolveStatusCategory(status, category) === "done";
}

export function isOpenStatus(
  status: string | null | undefined,
  category?: StatusCategory | string | null,
): boolean {
  return !isDoneStatus(status, category);
}

export function normalizeStatusName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export type MatchableStatus = {
  name: string;
  category?: string | null;
  position?: number | null;
};

// Resolves a requested status name against a project's columns:
//   1. exact name;
//   2. same name ignoring case, spaces, underscores and hyphens
//      ("client_input_needed" -> "Client Input Needed");
//   3. a legacy default name -> its v2 rename;
//   4. a legacy default name with no v2 counterpart on the project -> the
//      lowest-position not_started column;
//   5. null (a custom name that does not exist stays unresolved).
export function matchProjectStatusName<T extends MatchableStatus>(
  requestedName: string,
  statuses: readonly T[],
): T | null {
  const exact = statuses.find((status) => status.name === requestedName);
  if (exact) return exact;

  const normalized = normalizeStatusName(requestedName);
  const loose = statuses.find((status) => normalizeStatusName(status.name) === normalized);
  if (loose) return loose;

  const legacyTarget = LEGACY_STATUS_NAME_MAP[requestedName];
  if (!legacyTarget) return null;

  const mapped = statuses.find((status) => status.name === legacyTarget);
  if (mapped) return mapped;

  const notStarted = statuses
    .filter((status) => status.category === "not_started")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return notStarted[0] ?? null;
}
