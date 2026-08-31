// F009 (AS-019, AS-020, AS-021, AS-022): pure reconciliation of one
// Realtime `tasks` event into the calendar's `tasksByDate` bucket map.
// Extracted as a plain, React/DOM-free function — same "testable without
// a browser runtime" reasoning as lib/board/reconcile-realtime-task.ts —
// and called from calendar-day-grid.tsx's `useCalendarRealtime` callback.
//
// NOTE for a future worker (F010, "Calendar realtime — task reconciliation
// helper", depends on F009): this file already covers F010's assigned
// assertions end to end (INSERT/UPDATE-move/UPDATE-clear/DELETE) because
// F009 could not ship a working calendar subscription without a
// reconciler. F010 can either treat this file as already satisfying its
// scope (rename/relocate to `lib/tasks/reconcile-calendar-realtime-task.ts`
// if the exact path matters) or extend it — do not build a second,
// parallel implementation.
//
// Row shape limits (best-effort, same tradeoff
// lib/tasks/reconcile-list-realtime-task.ts documents for the List view):
// a bare `tasks` row event carries none of `CalendarTask`'s joined fields
// (`statusCategory`, `projectKey`, `projectName`, `assignees`) — those
// come from `project_statuses`/`projects`/`task_assignees` joins the
// initial server fetch resolves but a Realtime `tasks` event never
// carries. A newly-INSERTed task this client didn't already have is
// appended with those fields defaulted (`statusCategory: null, isDone:
// false, projectKey: null, projectName: ""`, `assignees: []`) so it's
// visible immediately (AS-020) rather than silently dropped; a task this
// client already has (UPDATE) keeps its previously-resolved joined fields
// and only patches the columns the event actually carries.
//
// AS-022 backstop: `visibleProjectIds` (the caller's own workspace's
// project id set, from the same `getWorkspaceProjects` read the page
// already does) gates every event, INSERT/UPDATE/DELETE alike, before it
// touches local state — see subscribe-calendar-realtime.ts's own doc
// comment for why this is required specifically for DELETE (RLS does not
// apply to DELETE broadcasts) and is a harmless, redundant-but-safe extra
// check for INSERT/UPDATE (RLS already gates those).

import type { CalendarTask } from "@/lib/queries/calendar";
import type { CalendarRealtimeEvent } from "@/lib/tasks/subscribe-calendar-realtime";
import type { DateOnly } from "@/lib/time/user-timezone";

export type CalendarTasksByDate = Record<string, CalendarTask[]>;

function findTask(
  byDate: CalendarTasksByDate,
  taskId: string,
): CalendarTask | undefined {
  for (const list of Object.values(byDate)) {
    const found = list.find((task) => task.id === taskId);
    if (found) return found;
  }
  return undefined;
}

function removeTaskEverywhere(
  byDate: CalendarTasksByDate,
  taskId: string,
): CalendarTasksByDate {
  let changed = false;
  const next: CalendarTasksByDate = {};
  for (const [date, list] of Object.entries(byDate)) {
    const filtered = list.filter((task) => task.id !== taskId);
    if (filtered.length !== list.length) changed = true;
    if (filtered.length > 0) next[date] = filtered;
  }
  return changed ? next : byDate;
}

export function reconcileCalendarRealtimeEvent(
  byDate: CalendarTasksByDate,
  event: CalendarRealtimeEvent,
  visibleProjectIds: ReadonlySet<string>,
): CalendarTasksByDate {
  if (event.eventType === "DELETE") {
    const deletedId = event.old?.id;
    const projectId = event.old?.project_id;
    if (!deletedId) return byDate;
    if (projectId && !visibleProjectIds.has(projectId)) return byDate;
    return removeTaskEverywhere(byDate, deletedId);
  }

  const row = event.new;
  // Validation (clarified answer 7): a malformed/partial payload missing
  // even `id`/`due_date` is ignored rather than acted on.
  if (!row || !row.id || !("due_date" in row)) return byDate;

  if (!visibleProjectIds.has(row.project_id)) return byDate;

  if (row.deleted_at) {
    return removeTaskEverywhere(byDate, row.id);
  }

  if (!row.due_date) {
    // UPDATE clearing due_date (AS-021).
    return removeTaskEverywhere(byDate, row.id);
  }

  // INSERT with a due_date (AS-020), or UPDATE that sets/changes due_date
  // (AS-019) — remove any stale placement, then re-insert into the
  // correct date bucket, merging onto the existing task's already-
  // resolved joined fields when we have them.
  const existing = findTask(byDate, row.id);
  const without = removeTaskEverywhere(byDate, row.id);

  const task: CalendarTask = existing
    ? {
        ...existing,
        title: row.title,
        status: row.status,
        priority: row.priority,
        dueDate: row.due_date as DateOnly,
        number: row.number ?? existing.number,
      }
    : {
        id: row.id,
        title: row.title,
        status: row.status,
        statusCategory: null,
        isDone: false,
        priority: row.priority,
        dueDate: row.due_date as DateOnly,
        number: row.number,
        projectId: row.project_id,
        projectKey: null,
        projectName: "",
        assignees: [],
      };

  const list = without[row.due_date] ?? [];
  return { ...without, [row.due_date]: [...list, task] };
}
