// F043: dnd-kit setup for the Kanban board. Owns the single DndContext for
// the whole board — sensors, drag state, and the DragOverlay — and hands
// each BoardColumn its slice of tasks plus a SortableContext.
//
// Scope per the clarified spec: dragging visually moves cards around
// client-side (dnd-kit's default sortable reordering) and persists the drop
// via onDragEnd below. Position (lib/board/position.ts's calculatePosition,
// from the dropped card's new neighbors) is always recomputed; if the
// column also changed, status and position are persisted together via
// F102's moveAndReorderTask (a single atomic Server Action — see that
// action's doc comment in lib/actions/tasks.ts for why status+position
// can't be two independent calls on a cross-column drag). A same-column
// reorder (status unchanged) still uses F046's single-purpose reorderTask.
//
// Sensors: PointerSensor (mouse/touch drag) AND KeyboardSensor are both
// configured — the keyboard sensor is required, not optional, per this
// feature's clarification (AS-151 depends on it). sortableKeyboardCoordinates
// is dnd-kit's standard coordinate getter for keyboard-driven sortable
// dragging (arrow keys move the focused item between droppable/sortable
// targets); pairing it with KeyboardSensor is the documented dnd-kit
// pattern for accessible sortable lists.
//
// PointerSensor gets a small activation distance so that a plain click
// (e.g. opening the task detail sheet via TaskCard's onClick, once that's
// wired up) isn't swallowed as a drag start.

"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";

import { reorderTask, moveAndReorderTask } from "@/lib/actions/tasks";
import { calculatePosition } from "@/lib/board/position";
import { reconcileTask } from "@/lib/board/reconcile-realtime-task";
import { BoardColumn } from "@/components/board/board-column";
import { TaskCard, type TaskCardTask } from "@/components/task/task-card";
import { useBoardRealtime } from "@/components/board/use-board-realtime";
import {
  NewTaskDialog,
  type NewTaskDialogAssigneeOption,
} from "@/components/task/new-task-dialog";
import { useTaskDetailSheet } from "@/components/task/use-task-detail-sheet";
import {
  TaskDetailSheet,
  type TaskDetailSheetMember,
} from "@/components/task/task-detail-sheet";
import type { UserAvatarPerson } from "@/components/user-avatar";

const FIXED_COLUMN_ORDER: TaskCardTask["status"][] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
];

export function Board({
  projectId,
  initialTasks,
  onCardClick,
  assigneeOptions = [],
  members = [],
  assignees,
  timezone,
}: {
  // F049 (AS-076): required so useBoardRealtime can scope its Postgres
  // Realtime subscription to this project only (matches AS-068's
  // per-project scoping — this client never receives another project's
  // task events).
  projectId: string;
  initialTasks: TaskCardTask[];
  // Optional override — when omitted (the normal case), the board opens
  // TaskDetailSheet itself via useTaskDetailSheet below. A caller may
  // still pass its own handler (e.g. a future alternate use), which
  // replaces the board's own click behavior entirely.
  onCardClick?: (taskId: string) => void;
  // Task-creation fix: workspace members offered as assignee choices in
  // the toolbar's "New Task" dialog. Defaults to `[]` so existing callers
  // (e.g. tests) that don't pass it don't crash — the dialog itself still
  // works fine with zero assignee options (the field is optional).
  assigneeOptions?: NewTaskDialogAssigneeOption[];
  // BUGFIX: workspace members offered as assignee choices inside the
  // opened TaskDetailSheet itself (its own assignee Select, distinct from
  // the New Task dialog's). Same shape TaskDetailSheet already declares
  // (TaskDetailSheetMember) — resolved server-side by the board page via
  // getWorkspaceMembers and passed down here, since that query needs the
  // Auth Admin client (server-only).
  members?: TaskDetailSheetMember[];
  /** F122 (AS-214): taskAssigneeId -> resolved person for every task's
   * avatar (task-card.tsx via SortableTaskCard/BoardColumn) and the drag
   * ghost below. Resolved once, server-side, by the board page
   * (resolveAssignees, lib/queries/assignee-names.ts) — not re-resolved
   * on every Realtime reconcile, so a task whose assignee changes via a
   * Realtime event from another viewer keeps showing its *previous*
   * assignee's avatar (or none) until the next full page load, the same
   * pre-existing limitation `assigneeNames`/`resolveAssigneeNames` already
   * has elsewhere in the app. */
  assignees?: Map<string, UserAvatarPerson>;
  /** F124 (AS-207): the viewer's IANA timezone, resolved once per request
   * by the board Server Component page (app/(workspace)/w/[workspaceSlug]/
   * projects/[projectId]/board/page.tsx) via lib/queries/profile.ts's
   * getCurrentUserTimezone — never re-fetched here, and never per card.
   * Threaded to every BoardColumn (-> SortableTaskCard -> TaskCard), the
   * DragOverlay's own TaskCard, and TaskDetailSheet below, so overdue
   * styling agrees everywhere on the board regardless of which of those
   * three renders a given task at a given moment. */
  timezone?: string;
}) {
  // Local, client-side-only copy of the board's tasks, optimistically
  // updated on drop by onDragEnd below (F102's moveAndReorderTask for
  // cross-column drags, F046's reorderTask for same-column reorders — both
  // rolled back to the pre-drop snapshot on failure).
  const [tasks, setTasks] = useState(initialTasks);
  const [activeTask, setActiveTask] = useState<TaskCardTask | null>(null);

  // F049 (AS-076): reconcile every Realtime event (this client's own
  // moves included — see reconcileTask's doc comment on why dedup isn't
  // needed) into local board state, so another viewer's drag shows up
  // here within a few seconds without a manual refresh.
  useBoardRealtime(projectId, (event) => {
    setTasks((current) => reconcileTask(current, event));
  });

  // BUGFIX: TaskDetailSheet was fully built (F039) but nothing ever
  // rendered it or wired a click handler to open it — see this file's own
  // former comment on PointerSensor's activation distance, which already
  // anticipated "opening the task detail sheet via TaskCard's onClick,
  // once that's wired up". `onCardClick` (an explicit prop) still wins
  // over this default so an existing/future caller can override it.
  const taskDetailSheet = useTaskDetailSheet();
  const handleCardClick = onCardClick ?? taskDetailSheet.openTask;

  function handleTaskDeleted(deletedTaskId: string) {
    setTasks((current) => current.filter((t) => t.id !== deletedTaskId));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    // `over.id` is either another task's id (dropped on/near a card) or a
    // column's status id (dropped on an empty column via useDroppable in
    // BoardColumn).
    const overTask = tasks.find((t) => t.id === over.id);
    const targetStatus = overTask
      ? overTask.status
      : (over.id as TaskCardTask["status"]);

    if (!FIXED_COLUMN_ORDER.includes(targetStatus)) return;

    // F107: the state computation below reads from `tasks` (the outer
    // component state, already settled from the last completed render) and
    // calls `setTasks(next)` with a plain value rather than a functional
    // updater. The Server Action calls and the `rollback` closure that can
    // itself call `setTasks` are triggered here, in the body of a genuine
    // event handler (dnd-kit's onDragEnd), AFTER that setTasks call —
    // never from inside a setState updater function. Previously the whole
    // computation, the mutation calls, and the rollback definition lived
    // inside a setTasks functional updater (`setTasks((prev) => { ... })`);
    // React can invoke a functional updater during its render/commit work
    // for that update,
    // so kicking off async Server Actions and a `rollback` that calls
    // `setTasks` from in there was the source of the "Cannot update a
    // component while rendering a different component" warning. Hoisting
    // all of that back into the event handler's own scope keeps every
    // `setTasks` call here a direct consequence of the event, not of
    // another render. (The realtime reconciliation callback elsewhere in
    // this component still uses a functional setTasks updater — that one
    // is fine, since it only ever runs from a genuine subscription-event
    // callback, never during another component's render pass.)
    const snapshot = tasks;

    const activeIndex = snapshot.findIndex((t) => t.id === active.id);
    if (activeIndex === -1) return;

    let insertAt: number;
    if (overTask) {
      const withoutActiveForIndex = snapshot.filter(
        (t) => t.id !== active.id,
      );
      insertAt = withoutActiveForIndex.findIndex((t) => t.id === overTask.id);
      if (insertAt === -1) insertAt = withoutActiveForIndex.length;
    } else {
      // Dropped on an empty/column-level target: append to the end of
      // that column's tasks.
      insertAt = snapshot.filter(
        (t) => t.id !== active.id && t.status === targetStatus,
      ).length;
    }

    // F046 (AS-070, AS-072, AS-073, AS-079): compute the moved card's new
    // `position` from its new neighbors *within the target column*,
    // using the same ordering the board renders (position-ascending,
    // per lib/queries/tasks.ts) — not the whole unfiltered `tasks`
    // array, which also holds every other column's cards.
    const withoutActive = snapshot.filter((t) => t.id !== active.id);
    const targetColumnTasks = withoutActive.filter(
      (t) => t.status === targetStatus,
    );
    const targetColumnInsertAt = overTask
      ? Math.max(0, targetColumnTasks.findIndex((t) => t.id === overTask.id))
      : targetColumnTasks.length;
    const prevNeighbor = targetColumnTasks[targetColumnInsertAt - 1] ?? null;
    const nextNeighbor = targetColumnTasks[targetColumnInsertAt] ?? null;
    const newPosition = calculatePosition(
      prevNeighbor?.position ?? null,
      nextNeighbor?.position ?? null,
    );

    const movedTask = {
      ...snapshot[activeIndex],
      status: targetStatus,
      position: newPosition,
    };

    const next = [
      ...withoutActive.slice(0, insertAt),
      movedTask,
      ...withoutActive.slice(insertAt),
    ];

    // F047 (AS-077): local state above is updated the instant the drop
    // happens — the card visually sits in its new column/position before
    // either Server Action below has resolved. If EITHER call fails, roll
    // back to the pre-drop `snapshot` and surface a single error toast
    // (sonner, matching the pattern used by edit-project-dialog.tsx /
    // new-project-dialog.tsx / etc.). A `rolledBack` flag guards against
    // double-rollback/double-toast when both calls fail, since they
    // resolve independently.
    setTasks(next);

    let rolledBack = false;
    function rollback(message: string) {
      if (rolledBack) return;
      rolledBack = true;
      setTasks(snapshot);
      toast.error(message);
    }

    // F102 (AS-077, fixing M5-scrutiny.md Finding 2): a drag that changes
    // BOTH status and position must go through the single atomic
    // moveAndReorderTask action, not two independent calls — otherwise a
    // moveTaskStatus success followed by a reorderTask failure leaves the
    // server with the new status but a stale position, while the client
    // rolls back to looking like the drag never happened. A drag that
    // only changes one of the two (same-column reorder, or a status-only
    // move with no reposition — not currently reachable from this
    // handler, but kept for other callers) can still use the single-
    // purpose actions, since there's nothing to coordinate.
    if (movedTask.status !== activeTask.status) {
      void moveAndReorderTask(movedTask.id, movedTask.status, newPosition)
        .then((result) => {
          if (!result.ok) {
            rollback(result.error);
          }
        })
        .catch(() => {
          rollback("Something went wrong moving that task. Please try again.");
        });
    } else {
      // F046 (AS-070, AS-078, AS-079, AS-080): same-column reorder —
      // status is unchanged, so only position needs to be persisted.
      void reorderTask(movedTask.id, newPosition)
        .then((result) => {
          if (!result.ok) {
            rollback(result.error);
          }
        })
        .catch(() => {
          rollback("Something went wrong moving that task. Please try again.");
        });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Task-creation fix: a "New Task" trigger visible on the board's
          own toolbar even once tasks already exist — previously the only
          create-task entry point was the empty state, which disappears
          the moment a project has its first task. */}
      <div className="flex justify-end">
        <NewTaskDialog projectId={projectId} assigneeOptions={assigneeOptions} />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {FIXED_COLUMN_ORDER.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={tasks.filter((task) => task.status === status)}
              assignees={assignees}
              onCardClick={handleCardClick}
              timezone={timezone}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              assignee={
                activeTask.assigneeId
                  ? assignees?.get(activeTask.assigneeId)
                  : null
              }
              timezone={timezone}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* BUGFIX: only rendered when the board owns its own click handling
          (onCardClick not overridden) — a caller supplying its own
          onCardClick is expected to render/own its own sheet instance,
          same "caller owns what onClick means" contract TaskCard's own
          doc comment describes. */}
      {!onCardClick && (
        <TaskDetailSheet
          task={taskDetailSheet.task}
          members={members}
          comments={taskDetailSheet.comments}
          attachments={taskDetailSheet.attachments}
          open={taskDetailSheet.open}
          onOpenChange={taskDetailSheet.onOpenChange}
          loading={taskDetailSheet.loading}
          error={taskDetailSheet.error}
          onRetry={taskDetailSheet.retry}
          onDeleted={handleTaskDeleted}
          currentUserId={taskDetailSheet.currentUserId}
          currentUserRole={taskDetailSheet.currentUserRole}
          timezone={timezone}
        />
      )}
    </div>
  );
}
