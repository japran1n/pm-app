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
// Scope/known limitation (Decisions Made, per the clarification's Round B
// Q2 "take the simpler option that adds no new dependency and no second
// source of truth"): the letters-only prefix pattern below matches every
// project key actually produced by F145's `derive_project_key_base` for a
// FRESH key (an ASCII-letters-only run of initials or truncated name),
// but not a key that itself ends in a digit after F145's collision-suffix
// step (e.g. a second "Marketing" project keyed "MARKET2"). A search for
// "MARKET2142" is genuinely ambiguous without knowing which keys exist in
// the target workspace (is it key "MARKET2" task 142, or key "MARKET"
// task 2142?) — resolving that would need the caller's own DB lookup, not
// this pure function, and is out of scope for this feature; the caller
// (lib/queries/search.ts) still finds such a task via ordinary full-text
// search on its title/description, and via the FTS-indexed key using the
// dash form ("MARKET2-142"), just not via this parser's no-dash form.
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

  const match = /^([A-Za-z]{1,6})[-\s]?(\d{1,9})$/.exec(trimmed);
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
