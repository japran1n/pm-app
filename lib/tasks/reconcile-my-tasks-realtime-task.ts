// F011 (AS-015, AS-016, AS-017): pure reconciliation helper for My Tasks'
// per-user Realtime subscription (components/my-tasks/use-my-tasks-realtime.ts,
// F008). Given the caller's current task list, one Realtime
// `postgres_changes` event on the `tasks` table, and the caller's own user
// id, returns the new task list -- no mutation of the input array, no
// side effects.
//
// Un-assignment (AS-017) has no dedicated event type: an UPDATE whose
// `new.assignee_id` is no longer `userId` (typically null, but any other
// user's id also counts) is treated as a removal, same rule F008's hook
// documents for forwarding raw payloads to `onDelete`. This helper
// re-derives that from the raw event + userId rather than depending on the
// caller to have already classified it, so it also works for callers that
// pass the raw Realtime payload straight through instead of going via the
// hook's onInsert/onUpdate/onDelete callbacks.
//
// Unknown/malformed events (missing id, unrecognized eventType) are
// dropped -- `tasks` is returned unchanged (same reference), per the
// clarified "Unknown event: return tasks unchanged" answer.
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export type MyTaskRealtimeRow = {
  id: string;
  assignee_id: string | null;
  [key: string]: unknown;
};

function hasValidId(record: unknown): record is { id: string } {
  return (
    typeof record === "object" &&
    record !== null &&
    "id" in record &&
    typeof (record as { id: unknown }).id === "string" &&
    (record as { id: string }).id.length > 0
  );
}

export function reconcileMyTasksRealtimeTask<T extends MyTaskRealtimeRow>(
  tasks: T[],
  event: RealtimePostgresChangesPayload<T>,
  userId: string,
): T[] {
  switch (event.eventType) {
    case "INSERT": {
      const row = event.new;
      if (!hasValidId(row)) return tasks;
      const record = row as T;
      if (record.assignee_id !== userId) return tasks;
      if (tasks.some((task) => task.id === record.id)) return tasks;
      return [...tasks, record];
    }
    case "UPDATE": {
      const row = event.new;
      if (!hasValidId(row)) return tasks;
      const record = row as T;

      if (record.assignee_id !== userId) {
        // AS-017: un-assigned (or re-assigned to someone else) -- remove.
        return tasks.filter((task) => task.id !== record.id);
      }

      const existingIndex = tasks.findIndex((task) => task.id === record.id);
      if (existingIndex === -1) {
        // Still assigned to us but not currently in the list -- treat like
        // an insert (e.g. first update we see after missing the original
        // INSERT).
        return [...tasks, record];
      }

      const next = tasks.slice();
      next[existingIndex] = record;
      return next;
    }
    case "DELETE": {
      const row = event.old;
      if (!hasValidId(row)) return tasks;
      const deletedId = (row as { id: string }).id;
      return tasks.filter((task) => task.id !== deletedId);
    }
    default:
      return tasks;
  }
}
