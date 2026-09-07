"use client";

// Follow-up to F227/F228/F229 saved views: drag-and-drop task-to-view
// membership, in ADDITION to (not replacing) the existing "Add to view"
// dropdown (components/task/add-to-view-menu.tsx). Reuses this codebase's
// existing dnd-kit convention (components/board/board.tsx: one shared
// DndContext at the top of the tree, PointerSensor + KeyboardSensor,
// useDraggable/useDroppable on the leaf elements) rather than inventing a
// second drag library or a parallel native HTML5 drag implementation.
//
// A single DndContext wraps BOTH the view tab row (components/views/
// view-tabs.tsx, each tab a useDroppable target) and the task table (each
// row a useDraggable source via TaskDragHandle below) even though those
// two components are siblings, not parent/child, in the List page's JSX --
// dnd-kit only requires both to be *descendants* of the same DndContext
// provider, which this wrapper (rendered once around both in list/page.tsx)
// satisfies.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";

import { addTaskToView } from "@/lib/actions/view-tasks";
import { cn } from "@/lib/utils";

export const TASK_DRAG_ID_PREFIX = "view-drop-task:";
export const VIEW_DROP_ID_PREFIX = "view-drop-target:";

// Dropped onto a view tab's droppable id carries the view's display name
// via `data.current`, mirroring board.tsx's own pattern of stashing extra
// context on a droppable/draggable's `data` field instead of re-deriving
// it from the id string alone.
export function ViewDropTab({
  viewId,
  viewName,
  children,
}: {
  viewId: string;
  viewName: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${VIEW_DROP_ID_PREFIX}${viewId}`,
    data: { viewId, viewName },
  });

  return (
    <div
      ref={setNodeRef}
      data-drop-active={isOver || undefined}
      className={cn(
        "rounded transition-colors",
        isOver && "bg-primary/10 ring-1 ring-primary/40",
      )}
    >
      {children}
    </div>
  );
}

// A small drag handle rendered per task row (components/task/
// task-list-table.tsx) -- deliberately NOT the whole row (the row already
// has a click-to-open-detail-sheet handler; making the entire row
// draggable would fight that gesture, same reasoning board.tsx's TaskCard
// applies to its own drag handle vs. its click-through).
export function TaskDragHandle({ taskId }: { taskId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${TASK_DRAG_ID_PREFIX}${taskId}`,
    data: { taskId },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label="Drag to add to a view"
      title="Drag onto a view tab to add this task to it"
      className={cn(
        "flex size-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
      onClick={(event) => event.stopPropagation()}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" aria-hidden="true" />
    </button>
  );
}

export function ViewDropContext({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith(TASK_DRAG_ID_PREFIX)) {
      setActiveTaskId(id.slice(TASK_DRAG_ID_PREFIX.length));
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId.startsWith(TASK_DRAG_ID_PREFIX) || !overId.startsWith(VIEW_DROP_ID_PREFIX)) {
      return;
    }

    const taskId = activeId.slice(TASK_DRAG_ID_PREFIX.length);
    const viewId = overId.slice(VIEW_DROP_ID_PREFIX.length);
    const viewName = (over.data.current?.viewName as string | undefined) ?? "view";

    const result = await addTaskToView({ viewId, taskId });
    if (result.ok) {
      toast.success(`Added to "${viewName}".`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTaskId(null)}
    >
      {children}
      {/* No DragOverlay: this drag's only visual feedback need is "which
          view tab am I over" (ViewDropTab's isOver highlight above), the
          same minimal feedback board.tsx's own cross-column drag relies on
          before rendering a custom overlay -- keeps this addition small. */}
      <span className="sr-only" aria-live="polite">
        {activeTaskId ? "Dragging a task. Drop it on a view tab to add it to that view." : ""}
      </span>
    </DndContext>
  );
}
