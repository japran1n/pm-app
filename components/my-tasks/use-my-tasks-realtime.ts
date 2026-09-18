// F008/F025 (AS-015, AS-016, AS-017, AS-018): Realtime subscription for the
// My Tasks page. Every task assigned to the current user, across every
// project the caller can see, should reflect live assignment/status/delete
// changes without a manual page refresh.
//
// Follows the same "thin client hook + shared ref-counted channel" pattern
// established by the board's own Realtime hook
// (components/board/use-board-realtime.ts, F049) and reuses
// lib/realtime/shared-topic-channel.ts (F329) to avoid the React
// StrictMode double-subscribe crash documented there.
//
// F025 root-cause fix: `tasks.assignee_id` is DEPRECATED (see
// supabase/migrations/20260822020000_task_assignees_table.sql) --
// assignment is now resolved through the `task_assignees` join table
// (many-to-many). F008's original implementation filtered Realtime's
// `postgres_changes` on `tasks.assignee_id=eq.<userId>`, which:
//   1. never fires for tasks assigned solely via `task_assignees` (the
//      write path every current caller uses -- AS-015 broken for every
//      real assignment), and
//   2. is structurally incapable of representing un-assignment (AS-017)
//      even for the legacy column: Supabase evaluates an UPDATE's row
//      filter against the NEW record, so a change that makes the filter
//      newly FALSE (row leaving the filtered set) is dropped server-side,
//      never delivered to the client at all.
//
// Fix: subscribe to TWO tables, both with no row filter (correctness is
// enforced by each table's own RLS SELECT policy, which Realtime
// re-applies before broadcasting -- the caller only ever receives rows
// they're allowed to see):
//   - `task_assignees`: INSERT with matching `user_id` means "task just
//     became mine" (AS-015); DELETE with matching `user_id` means "task
//     just stopped being mine" (AS-017). Both are forwarded as a
//     `onAssignmentChange` signal (kind: "assigned" | "unassigned") rather
//     than as a full task row, since `task_assignees` doesn't carry task
//     fields -- callers that need the fresh row (e.g. this feature's own
//     `PersonalTodoList` wiring) refetch/refresh in response.
//   - `tasks`: UPDATE forwards to `onUpdate` for any task already in the
//     caller's list (AS-016 -- status/field changes); DELETE forwards to
//     `onDelete` (AS-018). `tasks` INSERT is intentionally not treated as
//     "new to my list" here -- a brand-new task row is never itself an
//     assignment; the assignment side is what `task_assignees` INSERT
//     covers.
import { useEffect, useRef } from "react";
import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { subscribeWhenAuthenticated } from "@/lib/realtime/subscribe-when-authenticated";
import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type MyTasksRealtimeTaskRow = {
  id: string;
  [key: string]: unknown;
};

export type MyTasksRealtimeTaskEvent = RealtimePostgresChangesPayload<MyTasksRealtimeTaskRow>;

export type TaskAssigneeRow = {
  task_id: string;
  user_id: string;
  [key: string]: unknown;
};

export type MyTasksRealtimeAssigneeEvent = RealtimePostgresChangesPayload<TaskAssigneeRow>;

export type UseMyTasksRealtimeOptions = {
  userId: string | undefined;
  // AS-015: a task_assignees row was inserted for this user (new
  // assignment). Callers typically refetch/refresh here since only the
  // task id is known, not the full task row.
  onAssigned: (taskId: string) => void;
  // AS-017: a task_assignees row was deleted for this user (un-assigned).
  onUnassigned: (taskId: string) => void;
  // AS-016: an already-visible task was updated (status, title, etc.).
  onUpdate: (row: MyTasksRealtimeTaskRow) => void;
  // AS-018: a task was deleted outright.
  onDelete: (taskId: string) => void;
  // AS-018 (fix): task ids the caller already considers "mine"/visible at
  // mount time, e.g. from the server-rendered My Tasks list. Seeds the
  // hook's internal tracked-id set so `tasks` UPDATE/DELETE events for
  // those ids are recognised immediately, without requiring an
  // `onAssigned` event to have fired first during this session. Optional
  // -- defaults to empty, which is safe (a `tasks` event for a task this
  // session hasn't seen an assignment for yet is simply not forwarded
  // until one does).
  initialTaskIds?: Iterable<string>;
};

// Validates just enough of an incoming payload's shape to safely dispatch
// it -- a non-empty string `id` on the relevant record. Malformed/partial
// payloads (which should never happen against the real tables, but a
// defensive check per the clarified "validate before calling callbacks"
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

function hasValidTaskAssignee(record: unknown): record is TaskAssigneeRow {
  return (
    typeof record === "object" &&
    record !== null &&
    "task_id" in record &&
    typeof (record as { task_id: unknown }).task_id === "string" &&
    (record as { task_id: string }).task_id.length > 0 &&
    "user_id" in record &&
    typeof (record as { user_id: unknown }).user_id === "string" &&
    (record as { user_id: string }).user_id.length > 0
  );
}

export function subscribeToMyTasksRealtime(
  supabase: SupabaseClient,
  userId: string,
  handlers: Pick<UseMyTasksRealtimeOptions, "onAssigned" | "onUnassigned" | "onUpdate" | "onDelete">,
  // AS-018 (fix): mutable set of task ids this subscriber currently
  // considers tracked/visible. `task_assignees` INSERT/DELETE events keep
  // it in sync (assigned -> add, unassigned -> remove); `tasks`
  // UPDATE/DELETE events are only forwarded to the caller when the task's
  // id is already present here, so a workspace-wide change to a task the
  // caller never had (assigned to someone else, in another project, etc.)
  // is never propagated. Defaults to a fresh empty set for callers (e.g.
  // direct tests) that don't need to seed it.
  trackedTaskIds: Set<string> = new Set(),
): () => void {
  // F003 (AS-007): each binding lives on its OWN Realtime channel/topic.
  // Supabase reports SUBSCRIBED for a binding on an unpublished table and
  // then silently delivers nothing for EVERY binding sharing that same
  // channel -- co-locating `task_assignees` and `tasks` on one channel
  // means a publication gap in either table silently kills BOTH streams.
  // Splitting them means a dead binding on one topic can never take the
  // other down with it (AS-008, AS-009).
  const assigneesTopic = `tasks:my-tasks:${userId}:assignees`;
  const tasksTopic = `tasks:my-tasks:${userId}:tasks`;

  const releaseAssignees = acquireSharedTopicChannel<MyTasksRealtimeAssigneeEvent>(
    supabase,
    assigneesTopic,
    (dispatch) =>
      supabase
        .channel(assigneesTopic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "task_assignees",
          },
          (payload: MyTasksRealtimeAssigneeEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    (event) => {
      switch (event.eventType) {
        case "INSERT": {
          if (!hasValidTaskAssignee(event.new)) return;
          const row = event.new as TaskAssigneeRow;
          if (row.user_id !== userId) return;
          // AS-011: `trackedTaskIds` is the SAME Set instance passed to
          // the `tasks` channel's handler below -- an assignment learned
          // here is immediately visible there, even if the `tasks`
          // channel is (or later becomes) the dead one.
          trackedTaskIds.add(row.task_id);
          handlers.onAssigned(row.task_id);
          return;
        }
        case "DELETE": {
          if (!hasValidTaskAssignee(event.old)) return;
          const row = event.old as TaskAssigneeRow;
          if (row.user_id !== userId) return;
          trackedTaskIds.delete(row.task_id);
          handlers.onUnassigned(row.task_id);
          return;
        }
        default:
          return;
      }
    },
  );

  const releaseTasks = acquireSharedTopicChannel<MyTasksRealtimeTaskEvent>(
    supabase,
    tasksTopic,
    (dispatch) =>
      supabase
        .channel(tasksTopic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tasks",
          },
          (payload: MyTasksRealtimeTaskEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    (event) => {
      // AS-018: only forward events for tasks already tracked as "mine"
      // -- an UPDATE/DELETE that's merely RLS-visible (a task in another
      // project, or assigned to someone else) is not something this
      // caller currently sees, so it must not be propagated.
      switch (event.eventType) {
        case "UPDATE": {
          if (!hasValidId(event.new)) return;
          const row = event.new as MyTasksRealtimeTaskRow;
          if (!trackedTaskIds.has(row.id)) return;
          handlers.onUpdate(row);
          return;
        }
        case "DELETE": {
          if (!hasValidId(event.old)) return;
          const id = (event.old as { id: string }).id;
          if (!trackedTaskIds.has(id)) return;
          trackedTaskIds.delete(id);
          handlers.onDelete(id);
          return;
        }
        default:
          return;
      }
    },
  );

  // AS-010: unsubscribe releases BOTH channels; no channel survives a
  // caller's unmount.
  return () => {
    releaseAssignees();
    releaseTasks();
  };
}

/**
 * Subscribes to Realtime changes affecting tasks assigned to `userId`.
 * Calls `onAssigned`/`onUnassigned`/`onUpdate`/`onDelete` for as long as
 * this component stays mounted; unsubscribes (via the shared ref-counted
 * channel registry) automatically on unmount or when `userId` changes. A
 * `undefined` userId is a deliberate no-op -- there is nothing to scope the
 * subscription to before the caller is known.
 */
export function useMyTasksRealtime({
  userId,
  initialTaskIds,
  onAssigned,
  onUnassigned,
  onUpdate,
  onDelete,
}: UseMyTasksRealtimeOptions) {
  // AS-018 (fix): owns the tracked/visible task id set for the lifetime of
  // this subscription. Re-seeded from `initialTaskIds` whenever it changes
  // (e.g. a fresh server-rendered My Tasks list arrives), on top of
  // whatever this session has already learned from assignment events, so a
  // caller that supplies a fresher list never loses ids it already knows
  // about from a live `onAssigned` this render hasn't reflected yet.
  const trackedTaskIdsRef = useRef<Set<string>>(new Set(initialTaskIds ?? []));

  useEffect(() => {
    if (!initialTaskIds) return;
    for (const id of initialTaskIds) {
      trackedTaskIdsRef.current.add(id);
    }
  }, [initialTaskIds]);

  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    return subscribeWhenAuthenticated(supabase, (client) =>
      subscribeToMyTasksRealtime(
        client,
        userId,
        { onAssigned, onUnassigned, onUpdate, onDelete },
        trackedTaskIdsRef.current,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
