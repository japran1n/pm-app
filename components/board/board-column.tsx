// F042 (AS-067, AS-068): one fixed column of the Kanban board — a header
// (status label + count) plus the tasks in that status, rendered via the
// shared TaskCard (F040).
//
// F043: now the interactive drag-and-drop part lives here too. Each
// column is both a dnd-kit "droppable" (useDroppable, so a column with
// zero tasks can still receive a dropped card — SortableContext alone only
// covers reordering *within* an existing list of items) and a
// SortableContext (so cards inside it are keyboard/pointer reorderable).
// The DndContext that owns drag state (sensors, onDragEnd, DragOverlay)
// lives one level up in board.tsx — this component only renders the drop
// target, it does not decide what a drop means.
//
// Per-column empty state: a column with zero tasks (but the project has
// tasks elsewhere) still needs *some* explicit "nothing here" treatment so
// the board doesn't render a mysterious blank space — a lightweight inline
// message rather than the full BoardEmptyState (which is reserved for the
// whole-board "this project has zero tasks anywhere" case per F032/AS-041,
// composed once at the page level instead).

"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import type { TaskCardTask } from "@/components/task/task-card";
import {
  SortableTaskCard,
  type MoveToColumnOption,
} from "@/components/board/sortable-task-card";
import { QuickAdd } from "@/components/board/quick-add";
// F073 (AS-135): status labels/colors now come from the single shared
// lib/task-colors.ts constant, reused by the dashboard's status pie chart,
// instead of this component's own local copy.
import {
  STATUS_COLORS,
  STATUS_LABELS as COLUMN_LABELS,
} from "@/lib/task-colors";
import type { UserAvatarPerson } from "@/components/user-avatar";

export function BoardColumn({
  status,
  label,
  color,
  tasks,
  assignees,
  onCardClick,
  timezone,
  canDrag = true,
  dropId,
  laneKey,
  projectId,
  canCreateTask = false,
  onTaskCreated,
  onCreateError,
  onTaskOptimisticAdd,
  quickAddDefaults,
  moveToColumnOptions,
  onMoveToColumn,
}: {
  // F221 (AS-409, AS-416): the value tasks in this column are matched
  // against (`task.status === status`) AND the dnd-kit droppable id a
  // drop onto an empty column resolves to (see useDroppable below) --
  // for a project's real board columns this is the column's `name`
  // (project_statuses.name), which is what moveAndReorderTask/
  // moveTaskStatus (lib/actions/tasks.ts) now validate against and
  // persist. Still typed as the original fixed union for backward
  // compatibility with every existing caller that passes one of the
  // original four literal values (see label/color below) -- a caller
  // passing a custom column's real name works identically at runtime,
  // this is purely a pre-existing, not-yet-widened TS annotation (F223
  // owns any broader retyping of TaskCardTask itself).
  status: TaskCardTask["status"];
  /** F221 (AS-403): the column's real display name (project_statuses.name)
   * for a project's actual custom columns. Falls back to the fixed
   * STATUS_LABELS lookup for `status` when omitted, so every existing
   * caller (tests, and any caller not yet updated for custom columns)
   * keeps rendering exactly as before. */
  label?: string;
  /** F221 (AS-405): the column's real colour (project_statuses.color).
   * Falls back to the fixed STATUS_COLORS lookup for `status` when
   * omitted, same backward-compatible default as `label` above. */
  color?: string;
  tasks: TaskCardTask[];
  /** F122 (AS-214): taskAssigneeId -> resolved person, resolved once per
   * page load (board.tsx receives it from the Server Component page) —
   * looked up per card below rather than threaded through the whole
   * `tasks` array, mirroring task-list-table.tsx's pre-existing
   * `assigneeNames` Map convention. */
  assignees?: Map<string, UserAvatarPerson>;
  onCardClick?: (taskId: string) => void;
  /** F124/F275 (AS-207): the viewer's timezone, resolved once per request
   * by the Server Component page and passed straight through to every
   * SortableTaskCard in this column. REQUIRED since F275 — see board.tsx's
   * own doc comment on this same prop for why. */
  timezone: string;
  /** F135 (AS-231): passed straight through to every SortableTaskCard in
   * this column — see that component's own doc comment for why dragging
   * itself (not just the drop's Server Action) needs to be gated. */
  canDrag?: boolean;
  /** F224: overrides the dnd-kit droppable id (defaults to `status`).
   * Needed once a board renders more than one BoardColumn sharing the
   * same `status` at a time -- e.g. Swimlane renders one BoardColumn per
   * (lane, column) pair, and every lane's "To Do" column would otherwise
   * register the same `useDroppable({ id: "todo" })` id, which dnd-kit
   * does not support (ids must be unique across the whole DndContext).
   * Every existing caller (a plain, ungrouped board) omits this and keeps
   * exactly its pre-F224 id. Cross-lane drag-and-drop reassignment itself
   * (AS-420, AS-425) is F225's scope, not this one's -- Swimlane below
   * currently renders with `canDrag={false}`, so this prop only prevents
   * an id collision / dnd-kit console warning today, not a real drag
   * target yet. */
  dropId?: string;
  /** F225 (AS-420): the lane this BoardColumn instance belongs to
   * (undefined for an ungrouped board's plain columns) — threaded straight
   * through to every SortableTaskCard's `dndId` below so a task rendered
   * in more than one lane (multi-assignee/multi-tag, per F224's decision)
   * gets a distinct dnd-kit id per lane instead of colliding on
   * `task.id`. Purely an id-composition detail; this component still has
   * no opinion on what a cross-lane drop means (board.tsx's onDragEnd
   * owns that). */
  laneKey?: string;
  /** F248 (AS-479): required for the quick-add control to call createTask
   * (lib/actions/tasks.ts) -- omitted by any not-yet-updated caller
   * (existing tests), which simply never renders the control (see
   * `canCreateTask` below). */
  projectId?: string;
  /** F248: the viewer's real create-task permission (board.tsx's own
   * `canWrite`-derived value, the SAME one gating drag). Defaults to
   * `false` -- hidden entirely for a caller that hasn't passed it (viewers
   * never see the control), per this feature's draft scope ("Hidden
   * entirely for users without create rights"). The server
   * (createTaskForUser) still independently re-checks `canWrite` even if
   * this were somehow bypassed. */
  canCreateTask?: boolean;
  /** F248/F249 (AS-480, AS-481): fired with the server's real created task
   * (plus the optimistic placeholder's tempId) once createTask succeeds,
   * so the caller (board.tsx) can reconcile: swap the placeholder for
   * this real row, or drop the placeholder if Realtime's own INSERT echo
   * already added it. */
  onTaskCreated?: (task: TaskCardTask, tempId: string) => void;
  /** F248/F249: fired with createTask's error message (plus the
   * placeholder's tempId) on failure, so the caller can roll the
   * optimistic card back out and surface one toast -- see Clarified
   * implementation's Failure handling answer. */
  onCreateError?: (message: string, tempId: string) => void;
  /** F249 (AS-481): fired synchronously with a provisional card, before
   * createTask is awaited, so the caller can render it immediately.
   * Omitted (any not-yet-updated caller) falls back to F248's
   * non-optimistic behaviour -- the card only ever appears once the real
   * row comes back. */
  onTaskOptimisticAdd?: (task: TaskCardTask) => void;
  /** F248/F225: when this column is rendered inside a Swimlane, the
   * lane's own grouping field/value -- so a quick-add typed inside e.g.
   * the "Alice" assignee lane creates the task already assigned to Alice,
   * consistent with F225's cross-lane drag semantics (a task's grouped
   * field should always match the lane it's sitting in). Omitted for the
   * ungrouped board and for the "None" lane (nothing to default). */
  quickAddDefaults?: {
    assigneeId?: string | null;
    priority?: TaskCardTask["priority"];
  };
  /** F264 (AS-515): every OTHER real column on this board (this column
   * excluded), passed straight through to every SortableTaskCard in this
   * column's "Move to" menu -- resolved once by board.tsx (the same
   * `sortedColumns` state onDragEnd's own AS-409 validation reads), not
   * recomputed per column. Omitted (any not-yet-updated caller, e.g.
   * existing tests) hides the menu entirely, same "safe default"
   * convention as `canCreateTask`. */
  moveToColumnOptions?: MoveToColumnOption[];
  /** F264 (AS-515): fired by a card's "Move to" menu -- passed straight
   * through to board.tsx's real handler (mirrors onTaskCreated/
   * onCreateError's "caller owns the mutation" convention above). */
  onMoveToColumn?: (taskId: string, targetStatus: string) => void;
}) {
  // Makes an empty (or partially scrolled-past) column a valid drop
  // target even when it has no sortable items of its own yet.
  const { setNodeRef } = useDroppable({ id: dropId ?? status });

  // F225: composes the same `${laneKey}::${id}` id scheme `dropId` above
  // already uses, so `handleDragEnd` (board.tsx) can recover both a
  // task's real id and which lane a drag started in from one dnd-kit id.
  const dndIdFor = (taskId: string) =>
    laneKey ? `${laneKey}::${taskId}` : taskId;

  // F221 (AS-403, AS-405): a real column's own name/colour win when
  // provided; otherwise fall back to the fixed lookup so every existing
  // (not-yet-updated) caller renders identically to before this feature.
  const resolvedLabel = label ?? COLUMN_LABELS[status] ?? status;
  const resolvedColor = color ?? STATUS_COLORS[status] ?? "#64748b";

  return (
    <div
      ref={setNodeRef}
      // F264 (AS-514): below the `sm:` breakpoint (this codebase's
      // existing mobile-breakpoint convention -- see e.g.
      // components/app-sidebar.tsx's own `md:`/`sm:`-gated mobile
      // treatment) each column becomes one snap-stop in the board's
      // horizontal scroll-snap carousel (board.tsx's row wraps every
      // column in `snap-x snap-mandatory`) -- `max-sm:w-[88vw]` leaves a
      // visible peek of the next column (this feature's chosen "partial
      // peek" indicator, see board.tsx's own comment for why dots weren't
      // used). `max-sm:flex-none` (bugfix, post-handoff) is REQUIRED here,
      // not optional: the base `flex-1` class resolves to a non-`auto`
      // flex-basis, and per the flexbox spec a non-`auto` flex-basis makes
      // the browser ignore `width` entirely for main-axis sizing -- so
      // `max-sm:w-[88vw]` was being silently overridden by flex-grow
      // splitting the row evenly among every column (confirmed via
      // getComputedStyle at a 375px viewport: resolved width was ~50px,
      // an even 1/4 split, not 88vw). `max-sm:flex-none` resets
      // flex-basis to `auto` (and flex-grow/shrink to 0) so `width` governs
      // again, making `max-sm:shrink-0` redundant below `sm:` (kept anyway,
      // harmless, and documents intent). `sm:` and up are completely
      // unchanged from pre-F264 layout (`min-w-64 flex-1`, no snap classes).
      className="flex min-w-64 flex-1 flex-col gap-3 rounded-lg border border-border/60 bg-secondary p-3 max-sm:w-[88vw] max-sm:min-w-0 max-sm:flex-none max-sm:shrink-0 max-sm:snap-center"
      data-status={status}
    >
      <div className="flex items-center justify-between px-1 py-0.5">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: resolvedColor }}
          />
          {resolvedLabel}
          <span className="rounded-full bg-background px-1.5 py-0.5 text-xs font-normal text-muted-foreground ring-1 ring-border/60">
            ({tasks.length})
          </span>
        </h2>
      </div>

      <SortableContext
        items={tasks.map((task) => dndIdFor(task.id))}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-3">
          {tasks.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              No tasks
            </p>
          ) : (
            tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                assignee={
                  task.assigneeId ? assignees?.get(task.assigneeId) : null
                }
                // F161 (AS-287, AS-288): resolve every id in
                // `task.assigneeIds` (falls back to the single legacy
                // `assigneeId` when empty) against the SAME `assignees`
                // map this column already resolves the single-avatar
                // fallback from — no second batched query.
                assignees={(
                  task.assigneeIds && task.assigneeIds.length > 0
                    ? task.assigneeIds
                    : task.assigneeId
                      ? [task.assigneeId]
                      : []
                )
                  .map((id) => assignees?.get(id))
                  .filter((person): person is UserAvatarPerson => Boolean(person))}
                onClick={onCardClick}
                timezone={timezone}
                canDrag={canDrag}
                dndId={dndIdFor(task.id)}
                moveToColumnOptions={moveToColumnOptions}
                onMoveToColumn={onMoveToColumn}
              />
            ))
          )}
        </div>
      </SortableContext>

      {/* F248 (AS-479): hidden entirely (not disabled) for a viewer
          without create rights -- `canCreateTask` is the caller's real
          `canWrite`-derived permission, same convention `canDrag` already
          follows. The server (createTaskForUser) still independently
          re-checks on submit regardless of what this control renders. */}
      {canCreateTask && projectId ? (
        <QuickAdd
          projectId={projectId}
          status={status}
          laneDefaults={quickAddDefaults}
          onCreated={(task, tempId) => onTaskCreated?.(task, tempId)}
          onError={(message, tempId) => onCreateError?.(message, tempId)}
          onOptimisticAdd={(task) => onTaskOptimisticAdd?.(task)}
        />
      ) : null}
    </div>
  );
}
