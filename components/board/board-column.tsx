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
import { SortableTaskCard } from "@/components/board/sortable-task-card";
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
}) {
  // Makes an empty (or partially scrolled-past) column a valid drop
  // target even when it has no sortable items of its own yet.
  const { setNodeRef } = useDroppable({ id: status });

  // F221 (AS-403, AS-405): a real column's own name/colour win when
  // provided; otherwise fall back to the fixed lookup so every existing
  // (not-yet-updated) caller renders identically to before this feature.
  const resolvedLabel = label ?? COLUMN_LABELS[status] ?? status;
  const resolvedColor = color ?? STATUS_COLORS[status] ?? "#64748b";

  return (
    <div
      ref={setNodeRef}
      className="flex min-w-64 flex-1 flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
      data-status={status}
    >
      <div className="flex items-center justify-between px-1 py-0.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
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
        items={tasks.map((task) => task.id)}
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
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
