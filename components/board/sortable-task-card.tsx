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
import { MoreVertical } from "lucide-react";

import { TaskCard, type TaskCardTask } from "@/components/task/task-card";
import type { UserAvatarPerson } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// F264 (AS-515): one entry in the "Move to..." menu -- a lighter-weight
// shape than the board's full BoardColumnDef, since the menu only needs a
// column's identity (its real `name`, matched against `task.status`, same
// convention board.tsx's onDragEnd already uses) and its display label.
export type MoveToColumnOption = {
  name: string;
  label: string;
};

export function SortableTaskCard({
  task,
  assignee,
  assignees,
  onClick,
  timezone,
  canDrag = true,
  dndId,
  moveToColumnOptions,
  onMoveToColumn,
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
  /** F225 (AS-420): overrides the dnd-kit sortable/draggable id (defaults
   * to `task.id`). Needed once a board renders the SAME task more than
   * once at a time — a multi-assignee/multi-tag task appears in every
   * matching swimlane (F224's decision), so each rendered instance needs
   * a distinct dnd-kit id; BoardColumn below composes this as
   * `${laneKey}::${task.id}` (mirroring its own `dropId` prop's identical
   * pattern) so `handleDragEnd` can recover both which lane a drag
   * started in and the task's real id from a single dnd-kit id. Every
   * existing caller (an ungrouped board) omits this and keeps exactly its
   * pre-F225 `task.id` identity. */
  dndId?: string;
  /** F264 (AS-515): every OTHER column this task could move to (the
   * board's real columns, minus the one it's currently in) -- omitted or
   * empty hides the "Move to" menu entirely rather than rendering a
   * useless single-item/empty menu. Same "board's real current columns"
   * source F221's onDragEnd validation already uses -- see board.tsx's
   * `sortedColumns`. */
  moveToColumnOptions?: MoveToColumnOption[];
  /** F264 (AS-515): fired with the target column's real `name` when the
   * viewer picks it from the "Move to" menu -- board.tsx owns the actual
   * optimistic update + moveAndReorderTask call (mirroring onDragEnd's own
   * cross-column-drop path), same as every other mutation this card
   * triggers via a callback prop rather than calling a Server Action
   * itself. Omitted (any not-yet-updated caller, e.g. existing tests)
   * simply never renders the menu, same "safe default" convention as
   * `moveToColumnOptions` above. */
  onMoveToColumn?: (taskId: string, targetStatus: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dndId ?? task.id, disabled: !canDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    // dnd-kit sets `transition` only while actively sorting; for cards that
    // are merely shifting to make room (transform applied but transition=null),
    // the Tailwind `transition-transform` class below acts as the fallback so
    // the translateY still animates instead of jumping instantly.
    transition: transition ?? undefined,
  };

  const showMoveMenu =
    !!onMoveToColumn && !!moveToColumnOptions && moveToColumnOptions.length > 0;

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={{ ...style, minHeight: "60px" }}
        className="rounded-lg border-2 border-dashed border-border/50 bg-muted/30 transition-transform duration-200 ease-out will-change-transform"
        aria-hidden="true"
      />
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="relative transition-transform duration-200 ease-out will-change-transform">
      <div {...attributes} {...listeners} className={canDrag ? "cursor-grab active:cursor-grabbing" : undefined}>
        <TaskCard
          task={task}
          onClick={onClick}
          assignee={assignee}
          assignees={assignees}
          timezone={timezone}
          // Larger touch target on a phone-width board (AS-514): a couple
          // extra px of vertical padding at the card's own content level so
          // the tappable area (including the "Move to" trigger below,
          // which sits inside this same relatively-positioned wrapper)
          // stays comfortable on touch without changing anything at desktop
          // widths (`sm:` and up revert to the card's normal padding).
          className="max-sm:py-1"
        />
      </div>
      {/* F264 (AS-515): the touch-friendly "move to column" action -- the
          PRIMARY path for moving a task on a phone (per this feature's
          clarification: drag competes with page scroll on touch and is
          unreliable there), not a fallback. Kept visible at every width
          (not mobile-only) since it's also a faster path than dragging on
          desktop, but sized larger on a touch/mobile viewport
          (`max-sm:size-8`) to meet a comfortable touch-target size there.
          `stopPropagation` on the trigger keeps a tap from also bubbling
          into TaskCard's own onClick (which would open the detail sheet)
          or into dnd-kit's pointer-sensor drag-start listeners on the
          wrapper above. */}
      {showMoveMenu ? (
        <div
          className="absolute right-1.5 top-1.5"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 max-sm:size-8 bg-background/80 text-muted-foreground hover:text-foreground"
                  aria-label={`Move "${task.title}" to another column`}
                >
                  <MoreVertical className="size-4" aria-hidden="true" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {moveToColumnOptions.map((column) => (
                  <DropdownMenuItem
                    key={column.name}
                    onClick={() => onMoveToColumn(task.id, column.name)}
                  >
                    {column.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}
