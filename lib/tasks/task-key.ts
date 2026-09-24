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

// F147 (AS-262): the single parser for a search query that names a task
// key, e.g. "PM-142", "pm142", or "pm 142". This is the pure,
// side-effect-free counterpart to formatTaskKey above — formatTaskKey
// turns (projectKey, taskNumber) INTO a display string; this turns a
// free-typed search string BACK into (projectKey, taskNumber) candidates,
// with no database access and no knowledge of which project keys
// actually exist in any workspace (that lookup happens where this is
// called — lib/queries/search.ts for the workspace search page today).
//
// Per this feature's Notes for clarification ("The command palette (F242)
// will reuse it later, and a second copy of the regex must not appear"),
// this is exported specifically so F242 imports this function rather than
// re-implementing the pattern — the ONLY place in the codebase the
// key-search regex may appear.
//
// Case-insensitive: the input is upper-cased before matching, matching
// projects.key's own stored casing (F145's `projects_key_format` CHECK,
// `^[A-Z][A-Z0-9]{1,5}$`), so "pm-142" and "PM-142" resolve identically.
//
// Dash-tolerant: accepts a literal "-", a single space, or nothing at all
// between the letters and the digits ("PM-142", "pm 142", "pm142" all
// parse the same way) — per this feature's explicit instruction to
// "tolerate the dash being absent".
//
// Key format (REUSE-LOGIC-11): matches the DB's `projects_key_format`
// CHECK exactly — a letter followed by 1-5 letters/digits. Keys ending in a
// digit are real: `generate_unique_project_key` resolves collisions by
// appending an integer suffix ("MARKET" -> "MARKE2", "PM" -> "PM2"). The old
// letters-only pattern rejected every such key, so deep links (/t/PM2-14),
// search and dependency pickers could never resolve those tasks.
//
// With a separator ("PM2-14", "pm2 14") the split is unambiguous and any
// valid key is accepted. Without one ("pm214") the boundary between a
// digit-suffixed key and the task number is unknowable without a DB lookup,
// so the no-separator form only accepts a letters-only key (the common
// case), as before.
export const PROJECT_KEY_PATTERN = "[A-Za-z][A-Za-z0-9]{1,5}";

const WITH_SEPARATOR = new RegExp(`^(${PROJECT_KEY_PATTERN})[-\\s](\\d{1,9})$`);
const WITHOUT_SEPARATOR = /^([A-Za-z]{2,6})(\d{1,9})$/;

export interface ParsedTaskKeyQuery {
  projectKey: string;
  taskNumber: number;
}

export function parseTaskKeyQuery(query: string): ParsedTaskKeyQuery | null {
  if (!query) {
    return null;
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  const match = WITH_SEPARATOR.exec(trimmed) ?? WITHOUT_SEPARATOR.exec(trimmed);
  if (!match) {
    return null;
  }

  const [, rawKey, rawNumber] = match;
  const taskNumber = Number(rawNumber);

  if (!Number.isFinite(taskNumber) || taskNumber <= 0) {
    return null;
  }

  return {
    projectKey: rawKey.toUpperCase(),
    taskNumber,
  };
}
