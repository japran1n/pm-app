// F011 (SB-042): per-viewer, client-only "recently visited project" list
// used as the sidebar's fallback when the caller has no favourites yet.
//
// localStorage, not a server table: this is explicitly a convenience/
// per-device signal (the clarified spec calls this out directly), not
// data any RLS policy or another user ever needs to see. Every call is
// wrapped in try/catch -- a private-browsing tab or a full storage quota
// must never throw through into a broken sidebar render (same
// fail-open convention lib/queries/projects.ts's own favourites lookup
// documents for its own read failures).
const STORAGE_KEY = "sidebar:recent-projects";
const MAX_RECENT = 5;

export function readRecentProjectIds(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

// Records `projectId` as the most-recently-visited, de-duplicating any
// earlier occurrence and capping the stored list at MAX_RECENT entries
// (older entries are pushed out silently -- this is a convenience
// fallback, not a full history).
export function recordRecentProjectVisit(projectId: string): void {
  try {
    const existing = readRecentProjectIds().filter((id) => id !== projectId);
    const next = [projectId, ...existing].slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Fails silently -- see file header comment.
  }
}
