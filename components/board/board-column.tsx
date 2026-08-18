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
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { TaskCardTask } from "@/components/task/task-card";
import { SortableTaskCard } from "@/components/board/sortable-task-card";

const COLUMN_LABELS: Record<TaskCardTask["status"], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

export function BoardColumn({
  status,
  tasks,
  onCardClick,
}: {
  status: TaskCardTask["status"];
  tasks: TaskCardTask[];
  onCardClick?: (taskId: string) => void;
}) {
  // Makes an empty (or partially scrolled-past) column a valid drop
  // target even when it has no sortable items of its own yet.
  const { setNodeRef } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className="flex min-w-64 flex-1 flex-col gap-3 rounded-lg bg-muted/40 p-3"
      data-status={status}
    >
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium">{COLUMN_LABELS[status]}</h2>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>

      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          {tasks.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              No tasks
            </p>
          ) : (
            tasks.map((task) => (
              <SortableTaskCard key={task.id} task={task} onClick={onCardClick} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
