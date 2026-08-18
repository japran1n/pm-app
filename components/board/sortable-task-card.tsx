// F043: draggable wrapper around the shared TaskCard (F040). Each card in
// a board column is a dnd-kit "sortable" item — useSortable gives it the
// drag ref/listeners/transform needed for both pointer and keyboard
// dragging (the keyboard sensor, wired up in board.tsx, drives this same
// hook via arrow-key coordinate getters, so no separate keyboard-specific
// markup is needed here).
//
// Purely presentational/interactive glue: this component does not decide
// what happens when a drag ends (see board.tsx's onDragEnd) and does not
// call any Server Action — F043 is client-side-only reordering, F045/F046
// add persistence.

"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { TaskCard, type TaskCardTask } from "@/components/task/task-card";
import type { UserAvatarPerson } from "@/components/user-avatar";

export function SortableTaskCard({
  task,
  assignee,
  onClick,
  timezone,
}: {
  task: TaskCardTask;
  /** F122 (AS-214): resolved assignee, looked up by the caller
   * (BoardColumn) from its `assignees` map and passed straight through. */
  assignee?: UserAvatarPerson | null;
  onClick?: (taskId: string) => void;
  /** F124/F275 (AS-207): passed straight through to TaskCard — see that
   * component's own doc comment for where this ultimately comes from.
   * REQUIRED since F275. */
  timezone: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} onClick={onClick} assignee={assignee} timezone={timezone} />
    </div>
  );
}
