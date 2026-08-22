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
  assignees,
  onClick,
  timezone,
  canDrag = true,
}: {
  task: TaskCardTask;
  /** F122 (AS-214): resolved assignee, looked up by the caller
   * (BoardColumn) from its `assignees` map and passed straight through.
   * Deprecated in favour of `assignees` below (F161). */
  assignee?: UserAvatarPerson | null;
  /** F161 (AS-287, AS-288): every resolved assignee, looked up by the
   * caller (BoardColumn) from its `assigneesById` map and passed straight
   * through to TaskCard's UserAvatarGroup. */
  assignees?: UserAvatarPerson[];
  onClick?: (taskId: string) => void;
  /** F124/F275 (AS-207): passed straight through to TaskCard — see that
   * component's own doc comment for where this ultimately comes from.
   * REQUIRED since F275. */
  timezone: string;
  /** F135 (AS-231): a viewer/guest (lib/auth/permissions.ts's `canWrite`)
   * can look at the board but must never be able to drag a card into a
   * different status/position — dnd-kit's own `disabled` option on
   * useSortable is the correct place to gate this (not just "don't call
   * the Server Action on drop"), since leaving the card draggable would
   * let it visually reorder client-side and then silently snap back when
   * the mutation is rejected server-side — exactly the "control that will
   * fail" AS-231 forbids. Defaults to true so every existing caller that
   * hasn't been updated (e.g. tests, the DragOverlay's own bare TaskCard
   * usage in board.tsx which doesn't go through this component at all)
   * keeps its current behavior. */
  canDrag?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: !canDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard
        task={task}
        onClick={onClick}
        assignee={assignee}
        assignees={assignees}
        timezone={timezone}
      />
    </div>
  );
}
