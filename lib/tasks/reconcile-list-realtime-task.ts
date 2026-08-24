// F251 (AS-488, AS-489): merges one Realtime `postgres_changes` event for
// the `tasks` table into the project List view's local task list.
//
// Deliberately NOT `lib/board/reconcile-realtime-task.ts` reused directly
// — that function fully REPLACES a matched row with a freshly-built
// `TaskCardTask` derived only from the columns a `tasks`-table event can
// carry (id/title/status/priority/assignee_id/due_date/position/
// updated_at/number), which is exactly right for the board (it only ever
// renders those fields) but would silently drop List-view-only fields the
// initial server fetch populated and a bare `tasks` row event never
// carries: `assigneeIds` (plural, resolved from the `task_assignees` join
// table, F161), `statusCategory` (resolved via a join to
// `project_statuses`, F222), `totalMinutes`/`estimateMinutes` (aggregates,
// F113/F166), and `projectKey`. This function instead patches only the
// columns a Realtime `tasks` row event genuinely carries onto the
// existing task object, leaving every other already-loaded field
// untouched — same "merge, don't replace" principle, adapted to this
// view's wider row shape.
//
// `assigneeId` (legacy scalar) IS updated from the event — `assignee_id`
// is mirror-synced by `setTaskAssigneesCore` (lib/actions/tasks.ts,
// F160's doc comment) whenever the *_ids array changes, so a remote
// assignee-set edit still reaches this view's cells via the same fallback
// (`assigneeIds ?? [assigneeId]`) list-status-select.tsx's siblings
// already use. The plural `assigneeIds` array itself is NOT resolved from
// a bare `tasks` event (it isn't a `tasks` column) and is left as the
// list already had it — a documented, minor staleness only visible for a
// multi-assignee task edited by someone else while this client's tab is
// open, until the next full navigation/reload re-fetches it. Same
// class of tradeoff the board's own reconcileTask already accepts for
// its own set of fields it can't carry either.
//
// INSERT/UPDATE for a task this client doesn't have locally is appended
// as-is from the event's columns (best-effort — some optional fields, e.g.
// assigneeIds/statusCategory, won't be populated until the next reload) —
// same tradeoff `reconcileTask` already accepts for the board.
//
// Soft-deleted (deleted_at set) and hard-deleted (DELETE event) rows are
// both removed, same as the board.

import type { TaskCardTask } from "@/components/task/task-card";
import type { BoardRealtimeEvent } from "@/lib/board/subscribe-board-realtime";

export function reconcileListTask(
  tasks: TaskCardTask[],
  event: BoardRealtimeEvent,
): TaskCardTask[] {
  if (event.eventType === "DELETE") {
    const deletedId = event.old?.id;
    if (!deletedId) return tasks;
    return tasks.filter((task) => task.id !== deletedId);
  }

  const row = event.new;
  if (!row || !row.id) return tasks;

  if (row.deleted_at) {
    return tasks.filter((task) => task.id !== row.id);
  }

  const existingIndex = tasks.findIndex((task) => task.id === row.id);

  if (existingIndex === -1) {
    // Best-effort INSERT — see this file's header comment.
    const inserted: TaskCardTask = {
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      assigneeId: row.assignee_id,
      dueDate: row.due_date,
      position: row.position,
      updatedAt: row.updated_at,
      number: row.number,
    };
    return [...tasks, inserted];
  }

  const existing = tasks[existingIndex]!;

  // Ordering guard, identical to reconcileTask's — an out-of-order/
  // replayed event for a row we already have a newer version of is
  // dropped rather than applied.
  if (
    existing.updatedAt !== undefined &&
    row.updated_at !== undefined &&
    row.updated_at < existing.updatedAt
  ) {
    return tasks;
  }

  const merged: TaskCardTask = {
    ...existing,
    title: row.title,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    dueDate: row.due_date,
    position: row.position,
    updatedAt: row.updated_at,
    number: row.number ?? existing.number,
  };

  const next = tasks.slice();
  next[existingIndex] = merged;
  return next;
}
