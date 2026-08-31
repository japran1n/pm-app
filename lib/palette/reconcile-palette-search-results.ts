// F012 (AS-023, AS-024): pure reconciliation of a Realtime `tasks` event
// against the command palette's in-memory search results — kept separate
// from the hook so it's directly unit-testable (mirrors
// lib/board/reconcile-realtime-task.ts's split for the same reason).
//
// Per the clarified spec: only UPDATE (title/status patch) and DELETE (row
// removal) are handled — INSERT is intentionally a no-op, since a newly
// created task showing up mid-search would require re-running the search
// itself (out of scope; see handoff). Events missing `id` are ignored
// (validation answer: "check event payload has id before reconciling").

import type { PaletteSearchResults } from "@/lib/palette/palette-search-types";
import type { PaletteRealtimeEvent } from "@/lib/palette/subscribe-palette-search-realtime";

export function reconcilePaletteSearchResults(
  results: PaletteSearchResults,
  event: PaletteRealtimeEvent,
): PaletteSearchResults {
  if (event.eventType === "UPDATE") {
    const row = event.new as
      | { id?: string; title?: string; status?: string; deleted_at?: string | null }
      | undefined;
    if (!row?.id) return results;

    const index = results.tasks.findIndex((task) => task.id === row.id);
    if (index === -1) return results;

    // deleteTask (F-soft-delete) sets deleted_at rather than issuing a SQL
    // DELETE, so a soft-deleted task arrives as an UPDATE event, not a
    // DELETE event. Treat a non-null deleted_at the same as a hard delete.
    if (row.deleted_at) {
      return {
        ...results,
        tasks: results.tasks.filter((task) => task.id !== row.id),
      };
    }

    const existing = results.tasks[index];
    const updated = {
      ...existing,
      title: row.title ?? existing.title,
    };

    const tasks = results.tasks.slice();
    tasks[index] = updated;
    return { ...results, tasks };
  }

  if (event.eventType === "DELETE") {
    const row = event.old as { id?: string } | undefined;
    if (!row?.id) return results;

    const index = results.tasks.findIndex((task) => task.id === row.id);
    if (index === -1) return results;

    return {
      ...results,
      tasks: results.tasks.filter((task) => task.id !== row.id),
    };
  }

  return results;
}
