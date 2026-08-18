// F049 (AS-076): pure reducer that merges one Realtime `postgres_changes`
// event for the `tasks` table into the board's local task list.
//
// Extracted from board.tsx as a pure function (no dnd-kit/React
// dependency) specifically so it's unit-testable without a browser/DOM —
// the mechanics that matter here (insert into the right column, move to a
// new column/position, remove on delete/soft-delete) are pure list
// transforms independent of how the event arrived.
//
// Reconciliation strategy: always trust the incoming server row over local
// state, regardless of whether this client's own optimistic update caused
// it. Deduping "was this my own change" is unnecessary complexity — the
// server row is authoritative either way, and replacing-or-inserting by id
// is idempotent (an event for a task already reflected locally is a no-op
// diff).
//
// - INSERT: task appended if not already present (avoids a duplicate if
//   the local optimistic-create path — not yet built — already added it).
// - UPDATE: existing task (matched by id) replaced with the new row,
//   including status/position, so a moved task jumps to its new
//   column/slot. If the updated row is now soft-deleted
//   (deleted_at is not null), it's removed instead (AS-081-style: never
//   show a soft-deleted task).
// - DELETE: task removed by id. Postgres DELETE payloads only reliably
//   include the primary key unless the table has REPLICA IDENTITY FULL,
//   so this only relies on `old.id`.
//
// Within a column, callers render tasks sorted by `position` ascending
// (existing convention, lib/queries/tasks.ts) — this function does not
// sort; it only inserts/replaces/removes, matching how board.tsx already
// treats its `tasks` state as an unsorted bag bucketed by status at render
// time (see BoardColumn's per-status filter).

import type { TaskCardTask } from "@/components/task/task-card";
import type { BoardRealtimeEvent } from "@/lib/board/subscribe-board-realtime";

function toTaskCardTask(row: {
  id: string;
  title: string;
  status: TaskCardTask["status"];
  priority: TaskCardTask["priority"];
  assignee_id: string | null;
  due_date: string | null;
  position: number;
}): TaskCardTask {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    dueDate: row.due_date,
    position: row.position,
  };
}

export function reconcileTask(
  tasks: TaskCardTask[],
  event: BoardRealtimeEvent,
): TaskCardTask[] {
  if (event.eventType === "DELETE") {
    const deletedId = event.old?.id;
    if (!deletedId) return tasks;
    return tasks.filter((t) => t.id !== deletedId);
  }

  const row = event.new;
  if (!row || !row.id) return tasks;

  // Soft-deleted rows (deleted_at set) never appear on the board, whether
  // they arrive as the initial DELETE-equivalent soft-delete UPDATE or a
  // later one.
  if (row.deleted_at) {
    return tasks.filter((t) => t.id !== row.id);
  }

  const incoming = toTaskCardTask(row);
  const existingIndex = tasks.findIndex((t) => t.id === incoming.id);

  if (existingIndex === -1) {
    // INSERT (or an UPDATE for a task this client doesn't have locally yet
    // — e.g. it was created by another viewer moments before this client
    // subscribed): append.
    return [...tasks, incoming];
  }

  const next = tasks.slice();
  next[existingIndex] = incoming;
  return next;
}
