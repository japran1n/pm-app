// F224 (AS-418, AS-421, AS-423): one grouped "row" of the board -- a lane
// header (the group's label, plus a note on the multi-assignee/multi-tag
// counting rule when relevant) followed by the project's columns, each
// showing only this lane's tasks for that column, with its own
// independent per-column count (AS-421 -- BoardColumn already renders its
// own `(tasks.length)` badge; passing this lane's filtered task list is
// the whole mechanism, no separate counting logic needed here).
//
// Renders BoardColumn (unchanged component, same "no data => inline
// empty message per column" behaviour) reused per (lane, column) pair
// rather than a new lane-local column implementation -- per this
// feature's Clarified implementation ("the existing primitives and
// patterns... rather than new parallel implementations").
//
// Drag-and-drop reassignment between lanes (AS-420) and within-column
// reordering while grouped (AS-425) are F225's scope -- BoardColumn's
// drag affordances are deliberately disabled here (`canDrag={false}`,
// unconditionally, not gated on the viewer's role) so a grouped board
// never silently offers a drag that doesn't yet do anything meaningful;
// F225 should flip this back to the caller's real `canDrag` once
// cross-lane drops are implemented, and give each BoardColumn a
// lane-scoped `dropId` (already plumbed through by this feature -- see
// board-column.tsx's own doc comment on that prop) instead of leaving it
// unset.

import { BoardColumn } from "@/components/board/board-column";
import type { TaskCardTask } from "@/components/task/task-card";
import type { BoardColumnDef } from "@/lib/queries/statuses";
import type { UserAvatarPerson } from "@/components/user-avatar";

export function Swimlane({
  laneKey,
  label,
  avatar,
  columns,
  tasks,
  assignees,
  onCardClick,
  timezone,
  showMultiValueNote = false,
}: {
  laneKey: string;
  label: string;
  /** Resolved person for an assignee lane's header -- undefined for
   * priority/tag/None lanes, which have no avatar. */
  avatar?: UserAvatarPerson | null;
  columns: BoardColumnDef[];
  tasks: TaskCardTask[];
  assignees?: Map<string, UserAvatarPerson>;
  onCardClick?: (taskId: string) => void;
  timezone: string;
  /** AS-418's clarification note: multi-assignee/multi-tag tasks appear
   * in every one of their lanes, so a viewer summing every lane's count
   * would over-count relative to the board's real total -- shown once,
   * only on grouping modes where it can actually happen. */
  showMultiValueNote?: boolean;
}) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/40 p-3"
      data-swimlane={laneKey}
      aria-label={`${label} lane`}
    >
      <div className="flex items-center gap-2 px-1">
        {avatar ? (
          <span
            aria-hidden="true"
            className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium uppercase text-muted-foreground"
          >
            {(avatar.name ?? avatar.email ?? "?").slice(0, 1)}
          </span>
        ) : null}
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
          {tasks.length}
        </span>
        {showMultiValueNote ? (
          <span className="text-xs text-muted-foreground">
            (tasks with multiple values appear in more than one lane)
          </span>
        ) : null}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((column) => (
          <BoardColumn
            key={column.id}
            status={column.name as TaskCardTask["status"]}
            label={column.name}
            color={column.color}
            tasks={tasks.filter((task) => task.status === column.name)}
            assignees={assignees}
            onCardClick={onCardClick}
            timezone={timezone}
            // F225's scope -- see this file's own header comment.
            canDrag={false}
            dropId={`${laneKey}::${column.id}`}
          />
        ))}
      </div>
    </section>
  );
}
