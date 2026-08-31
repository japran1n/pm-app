// F008 (AS-015, AS-016, AS-017, AS-018): Realtime subscription for the My
// Tasks page. Every task assigned to the current user, across every
// project the caller can see, should reflect live INSERT/UPDATE/DELETE
// changes without a manual page refresh.
//
// Follows the same "thin client hook + shared ref-counted channel" pattern
// established by the board's own Realtime hook
// (components/board/use-board-realtime.ts, F049) and reuses
// lib/realtime/shared-topic-channel.ts (F329) to avoid the React
// StrictMode double-subscribe crash documented there. Unlike the board
// hook, this one is scoped per-USER (not per-project) since My Tasks spans
// every project the caller can see: channel/topic name is
// `tasks:my-tasks:<userId>`, filtered server-side via Realtime's row
// filter syntax to `assignee_id=eq.<userId>` (AS-018 -- only tasks
// currently assigned to the caller are delivered; Realtime additionally
// re-applies the `tasks` table's own RLS SELECT policy
// (tasks_select_active_members) before broadcasting, so a payload can
// never arrive for a project the caller isn't a member of, even if
// `assignee_id` happened to match).
//
// State ownership is left to the caller (per the clarified "callback-based"
// API contract) -- this hook has no opinion on how the three events turn
// into a new task list; F011's `reconcileMyTasksRealtimeTask` pure helper
// is the intended reconciliation function for callers that hold a task
// array in state.
//
// Un-assignment (AS-017) has no dedicated Postgres event: it arrives as an
// UPDATE whose `new.assignee_id` is no longer the caller's id (typically
// null, but any other user's id also means "no longer mine"). This hook
// treats any UPDATE where `new.assignee_id !== userId` as equivalent to a
// removal by invoking `onDelete` with the row's id, rather than forwarding
// it to `onUpdate` -- callers only ever need to reason about "is this task
// still in my list," not re-derive that from the raw payload themselves.
import { useEffect } from "react";
import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type MyTasksRealtimeTaskRow = {
  id: string;
  assignee_id: string | null;
  [key: string]: unknown;
};

export type MyTasksRealtimeEvent = RealtimePostgresChangesPayload<MyTasksRealtimeTaskRow>;

export type UseMyTasksRealtimeOptions = {
  userId: string | undefined;
  onInsert: (row: MyTasksRealtimeTaskRow) => void;
  onUpdate: (row: MyTasksRealtimeTaskRow) => void;
  onDelete: (taskId: string) => void;
};

// Validates just enough of an incoming payload's shape to safely dispatch
// it -- a non-empty string `id` on the relevant record. Malformed/partial
// payloads (which should never happen against the real `tasks` table, but
// a defensive check per the clarified "validate before calling callbacks"
// answer) are silently dropped rather than throwing or forwarding garbage
// to the caller's state.
function hasValidId(record: unknown): record is { id: string } {
  return (
    typeof record === "object" &&
    record !== null &&
    "id" in record &&
    typeof (record as { id: unknown }).id === "string" &&
    (record as { id: string }).id.length > 0
  );
}

export function subscribeToMyTasksRealtime(
  supabase: SupabaseClient,
  userId: string,
  handlers: Pick<UseMyTasksRealtimeOptions, "onInsert" | "onUpdate" | "onDelete">,
): () => void {
  const topic = `tasks:my-tasks:${userId}`;

  return acquireSharedTopicChannel<MyTasksRealtimeEvent>(
    supabase,
    topic,
    (dispatch) =>
      supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tasks",
            filter: `assignee_id=eq.${userId}`,
          },
          (payload: MyTasksRealtimeEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    (event) => {
      switch (event.eventType) {
        case "INSERT": {
          if (!hasValidId(event.new)) return;
          handlers.onInsert(event.new as MyTasksRealtimeTaskRow);
          return;
        }
        case "UPDATE": {
          if (!hasValidId(event.new)) return;
          const row = event.new as MyTasksRealtimeTaskRow;
          if (row.assignee_id !== userId) {
            // AS-017: un-assigned (or re-assigned to someone else) --
            // treat as a removal from this user's My Tasks list.
            handlers.onDelete(row.id);
            return;
          }
          handlers.onUpdate(row);
          return;
        }
        case "DELETE": {
          if (!hasValidId(event.old)) return;
          handlers.onDelete((event.old as { id: string }).id);
          return;
        }
        default:
          return;
      }
    },
  );
}

/**
 * Subscribes to Realtime changes for tasks assigned to `userId`. Calls
 * `onInsert`/`onUpdate`/`onDelete` for as long as this component stays
 * mounted; unsubscribes (via the shared ref-counted channel registry)
 * automatically on unmount or when `userId` changes. A `undefined` userId
 * is a deliberate no-op -- there is nothing to scope the subscription to
 * before the caller is known.
 */
export function useMyTasksRealtime({
  userId,
  onInsert,
  onUpdate,
  onDelete,
}: UseMyTasksRealtimeOptions) {
  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    const unsubscribe = subscribeToMyTasksRealtime(supabase, userId, {
      onInsert,
      onUpdate,
      onDelete,
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
