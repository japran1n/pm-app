// F221 (AS-413, AS-416): pure reducer that merges one Realtime
// `postgres_changes` event for `project_statuses` into the board's local
// column list -- mirrors lib/board/reconcile-realtime-task.ts's shape
// exactly (pure, no React/dnd-kit dependency, unit-testable without a
// DOM).
//
// - INSERT: column appended if not already present.
// - UPDATE: existing column (matched by id) replaced with the new row --
//   a rename/recolor/recategorize/reorder (position change) all arrive as
//   the same UPDATE shape.
// - DELETE: column removed by id.
//
// Callers render the returned list sorted by `position` ascending
// (matching lib/queries/statuses.ts's read order) -- this function does
// not sort; it only inserts/replaces/removes, same convention
// reconcileTask already follows for `tasks`.

import type { BoardColumnDef } from "@/lib/queries/statuses";
import type { BoardColumnsRealtimeEvent } from "@/lib/board/subscribe-board-columns-realtime";

export function reconcileColumn(
  columns: BoardColumnDef[],
  event: BoardColumnsRealtimeEvent,
): BoardColumnDef[] {
  if (event.eventType === "DELETE") {
    const deletedId = event.old?.id;
    if (!deletedId) return columns;
    return columns.filter((c) => c.id !== deletedId);
  }

  const row = event.new;
  if (!row || !row.id) return columns;

  const incoming: BoardColumnDef = {
    id: row.id,
    name: row.name,
    color: row.color,
    category: row.category,
    position: row.position,
  };

  const existingIndex = columns.findIndex((c) => c.id === incoming.id);

  if (existingIndex === -1) {
    return [...columns, incoming];
  }

  const next = columns.slice();
  next[existingIndex] = incoming;
  return next;
}
