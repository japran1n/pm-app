// F146 (AS-258): the single formatter for a task's human-readable
// "KEY-NUMBER" identifier (e.g. "PM-142"), combining a project's key
// (projects.key, F145) with a task's per-project sequential number
// (tasks.number, F145). This is the ONLY place in the codebase that
// concatenates those two values into that string — every surface that
// displays a task's identity (task card, task detail header, project
// list row, the workspace dashboard table that reuses the same list row,
// and workspace search results) imports and calls this function rather
// than reassembling `${key}-${number}` locally. F275's handoff describes
// exactly this class of bug for date formatting (a second hand-rolled
// copy of a formatter drifting out of sync with the shared one) — this
// file exists so task keys never repeat that mistake.
//
// Decision (the feature spec's one open question, resolved per the
// clarification's Round B Q2 "take the simpler option that adds no new
// dependency and no second source of truth; record the choice in the
// handoff's Decisions Made"): the displayed key always reflects the
// project's CURRENT key, not one frozen at task creation. Concretely,
// this function takes `projectKey`/`taskNumber` as plain arguments rather
// than reading from a per-task snapshot column — there is no
// `tasks.key_at_creation` or similar, so nothing could ever drift out of
// sync with `projects.key` if a project's key is edited later (F145's
// handoff: the DB already allows this via `projects.key`'s own
// UPDATE-time constraints; no editing UI exists yet, per that handoff's
// "Out-of-scope work needed"). This is simpler — no new column, no
// backfill, no second source of truth for this feature to introduce —
// and it matches Jira/Linear's own behavior, where renaming a project's
// key immediately changes how every one of its issues is displayed.
//
// Failure handling: a missing/blank project key or a missing/non-positive
// task number returns null rather than a malformed string like "-142" or
// "PM-undefined" — every caller treats null as "don't render the badge",
// never as an error to throw.
export function formatTaskKey(
  projectKey: string | null | undefined,
  taskNumber: number | null | undefined,
): string | null {
  if (!projectKey || !taskNumber || taskNumber <= 0) {
    return null;
  }
  return `${projectKey}-${taskNumber}`;
}
