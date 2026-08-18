// F043: dnd-kit setup for the Kanban board. Owns the single DndContext for
// the whole board — sensors, drag state, and the DragOverlay — and hands
// each BoardColumn its slice of tasks plus a SortableContext.
//
// Scope per the clarified spec: dragging visually moves cards around
// client-side (dnd-kit's default sortable reordering) and persists both
// halves of a drop via onDragEnd below — F045's moveTaskStatus (status,
// only called when the column actually changed) and F046's reorderTask
// (position, always called, computed via lib/board/position.ts's
// calculatePosition from the dropped card's new neighbors).
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

import { moveTaskStatus, reorderTask } from "@/lib/actions/tasks";
import { calculatePosition } from "@/lib/board/position";
import { reconcileTask } from "@/lib/board/reconcile-realtime-task";
import { BoardColumn } from "@/components/board/board-column";
import { TaskCard, type TaskCardTask } from "@/components/task/task-card";
import { useBoardRealtime } from "@/components/board/use-board-realtime";

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
}: {
  // F049 (AS-076): required so useBoardRealtime can scope its Postgres
  // Realtime subscription to this project only (matches AS-068's
  // per-project scoping — this client never receives another project's
  // task events).
  projectId: string;
  initialTasks: TaskCardTask[];
  onCardClick?: (taskId: string) => void;
}) {
  // Local, client-side-only copy of the board's tasks, optimistically
  // updated on drop by onDragEnd below (F045's moveTaskStatus + F046's
  // reorderTask, both rolled back to the pre-drop snapshot on failure).
  const [tasks, setTasks] = useState(initialTasks);
  const [activeTask, setActiveTask] = useState<TaskCardTask | null>(null);

  // F049 (AS-076): reconcile every Realtime event (this client's own
  // moves included — see reconcileTask's doc comment on why dedup isn't
  // needed) into local board state, so another viewer's drag shows up
  // here within a few seconds without a manual refresh.
  useBoardRealtime(projectId, (event) => {
    setTasks((current) => reconcileTask(current, event));
  });

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

    setTasks((current) => {
      const activeIndex = current.findIndex((t) => t.id === active.id);
      if (activeIndex === -1) return current;

      let insertAt: number;
      if (overTask) {
        const withoutActiveForIndex = current.filter(
          (t) => t.id !== active.id,
        );
        insertAt = withoutActiveForIndex.findIndex(
          (t) => t.id === overTask.id,
        );
        if (insertAt === -1) insertAt = withoutActiveForIndex.length;
      } else {
        // Dropped on an empty/column-level target: append to the end of
        // that column's tasks.
        insertAt = current.filter(
          (t) => t.id !== active.id && t.status === targetStatus,
        ).length;
      }

      // F046 (AS-070, AS-072, AS-073, AS-079): compute the moved card's new
      // `position` from its new neighbors *within the target column*,
      // using the same ordering the board renders (position-ascending,
      // per lib/queries/tasks.ts) — not the whole unfiltered `tasks`
      // array, which also holds every other column's cards.
      const withoutActive = current.filter((t) => t.id !== active.id);
      const targetColumnTasks = withoutActive.filter(
        (t) => t.status === targetStatus,
      );
      const targetColumnInsertAt = overTask
        ? Math.max(
            0,
            targetColumnTasks.findIndex((t) => t.id === overTask.id),
          )
        : targetColumnTasks.length;
      const prevNeighbor = targetColumnTasks[targetColumnInsertAt - 1] ?? null;
      const nextNeighbor = targetColumnTasks[targetColumnInsertAt] ?? null;
      const newPosition = calculatePosition(
        prevNeighbor?.position ?? null,
        nextNeighbor?.position ?? null,
      );

      const movedTask = {
        ...current[activeIndex],
        status: targetStatus,
        position: newPosition,
      };

      const next = [
        ...withoutActive.slice(0, insertAt),
        movedTask,
        ...withoutActive.slice(insertAt),
      ];

      // F047 (AS-077): local state above is already updated the instant the
      // drop happens — the card visually sits in its new column/position
      // before either Server Action below has resolved. If EITHER call
      // fails, roll back to the pre-drop `current` snapshot and surface a
      // single error toast (sonner, matching the pattern used by
      // edit-project-dialog.tsx / new-project-dialog.tsx / etc.). A
      // `rolledBack` flag guards against double-rollback/double-toast when
      // both calls fail, since they resolve independently.
      let rolledBack = false;
      function rollback(message: string) {
        if (rolledBack) return;
        rolledBack = true;
        setTasks(current);
        toast.error(message);
      }

      // F045 (AS-069): the card changed columns — persist the new status.
      // Optimistic: local state is already updated above; on failure, roll
      // back to the pre-drop state.
      if (movedTask.status !== activeTask.status) {
        void moveTaskStatus(movedTask.id, movedTask.status)
          .then((result) => {
            if (!result.ok) {
              rollback(result.error);
            }
          })
          .catch(() => {
            rollback("Something went wrong moving that task. Please try again.");
          });
      }

      // F046 (AS-070, AS-078, AS-079, AS-080): regardless of whether the
      // status also changed, persist the recomputed `position` — this is a
      // separate UPDATE from moveTaskStatus above (see reorderTask's doc
      // comment in lib/actions/tasks.ts for why the two aren't merged into
      // one call). Optimistic, with the same rollback-to-`current` on
      // failure.
      void reorderTask(movedTask.id, newPosition)
        .then((result) => {
          if (!result.ok) {
            rollback(result.error);
          }
        })
        .catch(() => {
          rollback("Something went wrong moving that task. Please try again.");
        });

      return next;
    });
  }

  return (
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
            onCardClick={onCardClick}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
