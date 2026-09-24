// F049 (AS-076): pure reducer that merges one Realtime `postgres_changes`
// event for the `tasks` table into a local `TaskCardTask[]` list.
//
// This is the ONE task-card reconciler shared by the board
// (components/board/board.tsx via `reconcileTask`) and the List view
// (lib/tasks/reconcile-list-realtime-task.ts re-exports it as
// `reconcileListTask`). The two used to be separate copies that diverged:
// the board's version REPLACED a matched card with an object built only
// from the columns a bare `tasks` row event carries, so every remote update
// wiped every join/aggregate-derived field the initial server fetch had
// populated (assigneeIds, statusCategory, totalMinutes, estimateMinutes,
// subtaskCount, openBlockerCount, completion, tags, taskType, recurrence,
// parentTaskId, projectKey, ...). Both views now MERGE: only the columns
// actually present in the payload are patched onto the existing card, and
// every other already-loaded field is kept.
//
// - INSERT (or an UPDATE for a task not held locally): appended,
//   best-effort, from the payload's columns. The project key is borrowed
//   from any other card on the list (every realtime subscription feeding
//   this reducer is scoped to one project, `project_id=eq.<id>`).
// - UPDATE: merged into the existing card (see `mergeRealtimeTaskRow`).
//   A soft-deleted row (deleted_at set) is removed instead.
// - DELETE: removed by `old.id` (DELETE payloads only reliably carry the
//   primary key without REPLICA IDENTITY FULL).
//
// Ordering guard (F103): an UPDATE whose `updated_at` is strictly older
// than the held card's is dropped (out-of-order / replayed event).

import type { TaskCardTask } from "@/components/task/task-card";
import type {
  BoardRealtimeEvent,
  BoardRealtimeTaskRow,
} from "@/lib/board/subscribe-board-realtime";

type RealtimeTaskRow = Partial<BoardRealtimeTaskRow> & { id: string };

/**
 * Patches the `tasks` columns present in a Realtime row onto an existing
 * card. A column absent from the payload (`undefined`) never clears the
 * card's current value; fields that aren't `tasks` columns at all are
 * always preserved.
 */
export function mergeRealtimeTaskRow(
  existing: TaskCardTask,
  row: RealtimeTaskRow,
): TaskCardTask {
  const merged: TaskCardTask = { ...existing };
  if (row.title !== undefined) merged.title = row.title;
  if (row.status !== undefined) merged.status = row.status;
  if (row.priority !== undefined) merged.priority = row.priority;
  if (row.assignee_id !== undefined) merged.assigneeId = row.assignee_id;
  if (row.due_date !== undefined) merged.dueDate = row.due_date;
  if (row.position !== undefined) merged.position = row.position;
  if (row.updated_at !== undefined) merged.updatedAt = row.updated_at;
  if (row.number !== undefined && row.number !== null) merged.number = row.number;
  return merged;
}

function toTaskCardTask(
  row: RealtimeTaskRow,
  projectKey: string | undefined,
): TaskCardTask {
  return {
    id: row.id,
    title: row.title ?? "",
    status: row.status ?? "todo",
    priority: row.priority ?? null,
    assigneeId: row.assignee_id ?? null,
    dueDate: row.due_date ?? null,
    position: row.position ?? 0,
    updatedAt: row.updated_at,
    number: row.number,
    projectKey,
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

  const row = event.new as RealtimeTaskRow | undefined;
  if (!row || !row.id) return tasks;

  if (row.deleted_at) {
    return tasks.filter((t) => t.id !== row.id);
  }

  const existingIndex = tasks.findIndex((t) => t.id === row.id);

  if (existingIndex === -1) {
    // F146 (AS-258): `projects.key` is not a `tasks` column, so borrow it
    // from any card already on this (single-project) list.
    const projectKey = tasks.find((t) => t.projectKey !== undefined)?.projectKey;
    return [...tasks, toTaskCardTask(row, projectKey)];
  }

  const existing = tasks[existingIndex]!;
  if (
    existing.updatedAt !== undefined &&
    row.updated_at !== undefined &&
    row.updated_at < existing.updatedAt
  ) {
    return tasks;
  }

  const next = tasks.slice();
  next[existingIndex] = mergeRealtimeTaskRow(existing, row);
  return next;
}
