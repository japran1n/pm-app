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
// appended with `statusCategory`, `projectKey`, `projectName` and
// `assignees` defaulted (genuinely unresolvable from this row alone) so
// it's visible immediately (AS-020) rather than silently dropped, but
// `isDone` is DERIVED from the row's own `status` column
// (`isDoneStatus(row.status)`, degraded/no-category path) rather than
// hardcoded `false` — see F029's handoff. A task this client already has
// (UPDATE) keeps its previously-resolved joined fields and only patches
// the columns the event actually carries.
//
// AS-022 backstop, DELETE: see the `eventType === "DELETE"` branch below
// for why this checks local-state presence, not `old.project_id` (F029
// fix — the previous project_id check was permanently inert because
// `tasks` lacks `replica identity full`).
//
// AS-022 backstop, INSERT/UPDATE: `visibleProjectIds` (the caller's own
// workspace's project id set, from the same `getWorkspaceProjects` read
// the page already does) gates INSERT/UPDATE before either touches local
// state — RLS already gates these at the Postgres level, so this is a
// harmless, redundant-but-safe extra check, not the primary mechanism.
//
// Known limitation (F029, not fixed here): if the calendar page is ever
// filtered by URL params (status/priority/assigneeId/projectId), a
// realtime-INSERTed task that doesn't match the active filter will still
// appear — `CalendarDayGrid` (components/calendar/calendar-day-grid.tsx)
// does not currently receive those filter values as props, only
// `workspaceId`/`projectIds` (visibility, not filtering). Wiring filters
// through requires the calendar page to thread its resolved filter object
// into `CalendarDayGrid` → `useCalendarRealtime` → this function; left as
// a documented gap rather than guessed at, since no such prop channel
// exists to hang a filter check off of today.
//
// F040 (AS-022, delivery scoping): `visibleDateRange` is the CURRENTLY
// DISPLAYED calendar window's inclusive `[start, end]` "YYYY-MM-DD"
// bounds — `CalendarDayGrid` derives it from `days[0].date` /
// `days[days.length - 1].date` (the full rendered grid, including
// leading/trailing days from adjacent months, per month-grid.ts). An
// INSERT/UPDATE for a task whose `due_date` falls outside this window is
// for a month/week the caller isn't looking at right now — dropping it
// into `byDate` would silently grow an off-screen bucket the grid never
// renders, which is harmless today but wastes memory and would surface a
// stale/wrong-looking task the moment the user navigates to that month
// without a fresh server fetch. String comparison is safe here: both the
// bounds and `row.due_date` are lexically-sortable "YYYY-MM-DD" values
// (`DateOnly`), so `<`/`>` compares chronologically without ever parsing
// into a `Date` (this file's month-grid.ts sibling already leans on the
// same property). `visibleDateRange` is OPTIONAL and defaults to "no
// scoping" (all callers, including every existing test, keep working
// unchanged) — the calendar page always passes it in practice.

import type { CalendarTask } from "@/lib/queries/calendar";
import type { CalendarRealtimeEvent } from "@/lib/tasks/subscribe-calendar-realtime";
import { isDoneStatus } from "@/lib/tasks/status-category";
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
  visibleDateRange?: { start: DateOnly; end: DateOnly },
): CalendarTasksByDate {
  if (event.eventType === "DELETE") {
    // AS-022: `tasks` has no `replica identity full`, so a DELETE's `old`
    // record only ever carries `{id}` -- `old.project_id` is always
    // undefined and can never be trusted to gate this event (the previous
    // `if (projectId && !visibleProjectIds.has(projectId))` check was
    // therefore permanently inert: `projectId` was always falsy, so every
    // DELETE fell through to `removeTaskEverywhere` unconditionally).
    // The client-side backstop for "don't let a DELETE for a task outside
    // this caller's visibility remove local state" instead checks whether
    // the deleted id is present in the caller's OWN local `byDate` state
    // to begin with: a task only ever entered `byDate` via the initial
    // (RLS-gated) server fetch or a prior RLS-gated INSERT/UPDATE, so "not
    // present locally" is equivalent to "not visible to this caller" --
    // and also cheaply no-ops on DELETE events for tasks this client never
    // had (e.g. undated tasks, or another workspace's tasks slipping
    // through before the channel is properly scoped).
    const deletedId = event.old?.id;
    if (!deletedId) return byDate;
    if (!findTask(byDate, deletedId)) return byDate;
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

  // F040 (AS-022): the row has a due_date, but it may fall outside the
  // window the caller is currently displaying (see this file's header
  // comment on `visibleDateRange`). Out-of-window INSERTs are simply
  // ignored (nothing to render); out-of-window UPDATEs also remove any
  // stale in-window placement the task previously had, since it moved
  // out of view.
  if (
    visibleDateRange &&
    (row.due_date < visibleDateRange.start ||
      row.due_date > visibleDateRange.end)
  ) {
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
        // AS-020 (F036 fix): an UPDATE that changes a task's status (e.g.
        // moving it into/out of a "done" column) must re-derive `isDone`
        // from the NEW status rather than silently carrying over the
        // stale value from when this task was first inserted into local
        // state -- `...existing` above would otherwise leave `isDone`
        // permanently pinned to whatever it was on first sight. Passing
        // `existing.statusCategory` here is WRONG: `isDoneStatus` short-
        // circuits on a non-null category and returns purely based on
        // that category, ignoring `row.status` entirely -- so a task
        // moved to a "done"-category status would still read as not-done
        // because `existing.statusCategory` reflects the OLD status, not
        // the new one. A bare `tasks` row event never carries the
        // category join for the NEW status, so there is no trustworthy
        // category to pass here; degrade to the literal
        // `row.status === "done"` comparison instead (same degraded path
        // the INSERT branch below already uses) by passing no category.
        isDone: isDoneStatus(row.status),
        priority: row.priority,
        dueDate: row.due_date as DateOnly,
        number: row.number ?? existing.number,
      }
    : {
        id: row.id,
        title: row.title,
        status: row.status,
        // AS-020: a bare `tasks` row event never carries the
        // `project_statuses(category)` join the initial server fetch
        // resolves, so `statusCategory` genuinely can't be known here and
        // stays `null` (the field lib/tasks/status-category.ts already
        // treats as the "status_id unresolved, degrade to literal string
        // comparison" case). `isDone` IS derivable from `row.status`
        // alone via that same degraded path -- `isDoneStatus(row.status)`
        // (no category arg) falls back to a literal `status === "done"`
        // comparison instead of always hardcoding `false`, which is
        // wrong for any task realtime-inserted with a "done" status.
        statusCategory: null,
        isDone: isDoneStatus(row.status),
        priority: row.priority,
        dueDate: row.due_date as DateOnly,
        number: row.number,
        projectId: row.project_id,
        projectKey: null,
        // `projectKey`/`projectName`/`assignees` require joins
        // (`projects`, `task_assignees`) a bare `tasks` row event never
        // carries -- genuinely unavailable here, not merely unused, so
        // these stay defaulted rather than fabricated. See this feature's
        // handoff for the follow-up needed to resolve them (e.g. a
        // client-side lookup against the already-fetched project list).
        projectName: "",
        assignees: [],
      };

  const list = without[row.due_date] ?? [];
  return { ...without, [row.due_date]: [...list, task] };
}
