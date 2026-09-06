// F232 (AS-442, AS-450) + F233 (AS-444, AS-447): one day cell in the month
// grid -- the day number, the compact task chips due on it (each a real
// click-through to the board's `?taskId=` deep link -- see TaskChip below,
// the exact same route/param board.tsx's own click-to-open effect already
// listens on, so AS-444 is proven against the real getTaskDetail path, not
// a second sheet built here), and, once a cell has more tasks than fit, an
// overflow control (day-overflow.tsx) revealing the rest.
//
// F234 (AS-445): this cell is now also a dnd-kit droppable (the WHOLE
// cell, via `useDroppable({ id: day.date })` -- `day.date` is already the
// cell's own real "YYYY-MM-DD", including the correct adjacent-month date
// for a leading/trailing cell, per lib/calendar/month-grid.ts's own doc
// comment -- so a drop is identified by that exact string, never a
// locally-constructed `Date` that could roll across a timezone boundary),
// and each visible chip is a dnd-kit draggable (`useDraggable({ id:
// task.id })`). The `DndContext`/`onDragEnd`/optimistic-update/rollback
// logic that turns a drop into a real `editTask` call lives one level up
// in components/calendar/calendar-day-grid.tsx (F234), mirroring how
// board.tsx owns `handleDragEnd` while board-column.tsx/sortable-task-
// card.tsx only render the drop/drag targets -- this file only renders
// them, it does not decide what a drop means.
//
// This file switched from a Server Component to "use client" for F234
// (dnd-kit's hooks are client-only) -- pure presentation, no data
// fetching of its own either way, so nothing about its own props/behavior
// otherwise changed.
//
// AS-447's cap: a day cell shows at most DAY_CELL_VISIBLE_TASKS chips
// inline; anything beyond that renders behind the "+N more" popover
// instead of growing the cell's height (which would break the month
// grid's fixed-row layout other days rely on). Overflow chips (inside the
// popover) are not draggable -- dragging out of a popover is out of this
// feature's scope; the popover is closed on drag start of a visible chip
// anyway.

"use client";

import Link from "next/link";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
import { UserAvatarGroup } from "@/components/user-avatar-group";
import { DayOverflow } from "@/components/calendar/day-overflow";
import { CalendarBlockChip } from "@/components/calendar/calendar-block-chip";
import { AddBlockPopover } from "@/components/calendar/add-block-popover";
import { cn } from "@/lib/utils";

const DAY_CELL_VISIBLE_TASKS = 3;

export function DayCell({
  day,
  tasks,
  blocks = [],
  workspaceSlug,
  // F234 (AS-445): defaults to `true` so every existing/not-yet-updated
  // caller (this file's own pre-F234 tests included) keeps rendering a
  // draggable cell exactly as before -- board's SortableTaskCard/
  // BoardColumn use the identical `canDrag = true` default for the same
  // reason (see sortable-task-card.tsx's own doc comment).
  canDrag = true,
  onCreateBlock,
  onUpdateBlock,
  onDeleteBlock,
}: {
  day: CalendarDay;
  tasks: CalendarTask[];
  /** Planner feature: freeform time blocks anchored to this cell's own
   * date -- optional so any existing caller/test that doesn't pass these
   * keeps rendering exactly as before (same convention `workspaceId`/
   * `projectIds` already use one level up). */
  blocks?: CalendarBlock[];
  workspaceSlug: string;
  canDrag?: boolean;
  onCreateBlock?: (values: {
    title: string;
    startsAt: string;
    endsAt: string;
  }) => Promise<void> | void;
  onUpdateBlock?: (
    blockId: string,
    values: { title: string; startsAt: string; endsAt: string },
  ) => Promise<void> | void;
  onDeleteBlock?: (blockId: string) => Promise<void> | void;
}) {
  const dayNumber = Number(day.date.slice(-2));
  const visibleTasks = tasks.slice(0, DAY_CELL_VISIBLE_TASKS);
  const overflowTasks = tasks.slice(DAY_CELL_VISIBLE_TASKS);

  // F234 (AS-445): droppable id is the cell's OWN "YYYY-MM-DD" -- for a
  // leading/trailing day this is already the adjacent month's real date
  // (lib/calendar/month-grid.ts builds `day.date` that way), never the
  // visible grid's month/year clamped onto it.
  const { setNodeRef, isOver } = useDroppable({ id: day.date });

  return (
    <div
      ref={setNodeRef}
      data-date={day.date}
      data-testid={`calendar-day-cell-${day.date}`}
      className={cn(
        "group flex min-h-[7rem] flex-col gap-1 border-b border-r border-border/60 p-1.5 text-xs",
        !day.isCurrentMonth && "bg-muted/30 text-muted-foreground",
        isOver && "bg-primary/10 ring-1 ring-inset ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium",
            day.isToday && "bg-primary text-primary-foreground",
          )}
        >
          {dayNumber}
        </span>
        {onCreateBlock && <AddBlockPopover date={day.date} onCreate={onCreateBlock} />}
      </div>
      <div className="flex flex-col gap-1 overflow-hidden">
        {visibleTasks.map((task) => (
          <DraggableTaskChip
            key={task.id}
            task={task}
            workspaceSlug={workspaceSlug}
            canDrag={canDrag}
          />
        ))}
        <DayOverflow tasks={overflowTasks} workspaceSlug={workspaceSlug} />
        {blocks.map((block) => (
          <CalendarBlockChip
            key={block.id}
            block={block}
            canDrag={canDrag}
            onUpdate={onUpdateBlock ?? (() => {})}
            onDelete={onDeleteBlock ?? (() => {})}
          />
        ))}
      </div>
    </div>
  );
}

function DraggableTaskChip({
  task,
  workspaceSlug,
  canDrag,
}: {
  task: CalendarTask;
  workspaceSlug: string;
  canDrag: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, disabled: !canDrag });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskChip task={task} workspaceSlug={workspaceSlug} />
    </div>
  );
}

function TaskChip({
  task,
  workspaceSlug,
}: {
  task: CalendarTask;
  workspaceSlug: string;
}) {
  const key = formatTaskKey(task.projectKey, task.number);
  const priority = (task.priority ?? "none") as keyof typeof PRIORITY_COLORS;

  return (
    <Link
      href={`/w/${workspaceSlug}/projects/${task.projectId}/board?taskId=${task.id}`}
      className={cn(
        "flex min-w-0 items-center gap-1 truncate rounded border border-border/60 bg-card px-1.5 py-0.5 hover:bg-muted/60",
        task.isDone && "opacity-60 line-through",
      )}
      title={task.title}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: PRIORITY_COLORS[priority] }}
        aria-hidden
      />
      <span className="sr-only">{PRIORITY_LABELS[priority]}</span>
      {key && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {key}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      {task.assignees.length > 0 && (
        <UserAvatarGroup
          people={task.assignees.map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            avatarUrl: a.avatarUrl,
          }))}
          size="sm"
          max={1}
        />
      )}
    </Link>
  );
}
