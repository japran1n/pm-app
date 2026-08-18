// F043: dnd-kit setup for the Kanban board. Owns the single DndContext for
// the whole board — sensors, drag state, and the DragOverlay — and hands
// each BoardColumn its slice of tasks plus a SortableContext.
//
// Scope per the clarified spec: dragging may visually move cards around
// client-side (dnd-kit's default sortable reordering) but does NOT persist
// to the server yet. That's F045 (status-change Server Action) and F046
// (position-persist Server Action) — see the TODO markers in onDragEnd
// below for exactly where those calls plug in.
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

import { BoardColumn } from "@/components/board/board-column";
import { TaskCard, type TaskCardTask } from "@/components/task/task-card";

const FIXED_COLUMN_ORDER: TaskCardTask["status"][] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
];

export function Board({
  initialTasks,
  onCardClick,
}: {
  initialTasks: TaskCardTask[];
  onCardClick?: (taskId: string) => void;
}) {
  // Local, client-side-only copy of the board's tasks. F043 is explicitly
  // "visual move only" — this state is never written back to the server.
  // F045/F046 will replace (or wrap) this with Server Action calls that
  // persist status/position, most likely via optimistic updates layered
  // on top of this same local state.
  const [tasks, setTasks] = useState(initialTasks);
  const [activeTask, setActiveTask] = useState<TaskCardTask | null>(null);

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

      const movedTask = { ...current[activeIndex], status: targetStatus };
      const withoutActive = current.filter((t) => t.id !== active.id);

      let insertAt: number;
      if (overTask) {
        insertAt = withoutActive.findIndex((t) => t.id === overTask.id);
        if (insertAt === -1) insertAt = withoutActive.length;
      } else {
        // Dropped on an empty/column-level target: append to the end of
        // that column's tasks.
        insertAt = withoutActive.length;
      }

      const next = [
        ...withoutActive.slice(0, insertAt),
        movedTask,
        ...withoutActive.slice(insertAt),
      ];

      // TODO(F045): if `movedTask.status !== activeTask.status`, call the
      // status-change Server Action here (e.g. updateTaskStatus(movedTask.id,
      // movedTask.status)) — ideally optimistic, with rollback to `current`
      // on failure.
      // TODO(F046): regardless of whether the status changed, the new
      // ordering within `targetStatus` (and the column the task left, if
      // different) needs its `position` values persisted — call the
      // position-persist Server Action here with the recomputed order,
      // again optimistic with rollback to `current` on failure.

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
