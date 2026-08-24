// F238 (AS-454): the "use client" drag/resize wrapper around a single
// bar/marker, using @dnd-kit's `useDraggable` -- three separate
// draggable regions per RANGE bar (whole-bar move, start-edge resize,
// end-edge resize handles) and ONE (whole-marker move only -- see
// lib/timeline/reschedule.ts's own doc comment on why a marker has no
// second edge to resize) for a marker. No droppable target is needed:
// unlike the calendar's day-cell drop zones (F234), the timeline is a
// continuous pixel axis, so the plan is derived from the raw pointer
// `delta.x` on drag end (`pixelDeltaToDayDelta`), the same "delta-based,
// no discrete drop zones" shape @dnd-kit's own docs use for free-axis
// dragging.
//
// Keyboard alternative (this feature's own Draft-scope line): @dnd-kit's
// `KeyboardSensor` already makes any `useDraggable` region keyboard-
// operable (arrow keys move the DOM transform by its default coordinate
// getter's step) with no extra code here -- the SAME sensor pair
// components/calendar/calendar-day-grid.tsx (F234) and
// components/board/board.tsx already register, reused verbatim rather
// than reimplemented, satisfies "keyboard alternative for adjusting
// dates on a focused bar" without inventing a second interaction model.
//
// Rendering during a drag: this wrapper never mutates `layout` itself
// (that stays this render's own authoritative position, driven by
// TimelineBody's `overrides` state -- see that file) -- it only applies
// dnd-kit's own `transform` as a visual CSS offset while a drag is in
// flight, snapping back to the (possibly server-confirmed, possibly
// rolled-back) real position the instant the drag ends, exactly the
// "optimistic state lives in the parent, this component is a plain
// controlled view" shape CalendarDayGrid/DayCell already use.

"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import type { TimelineBarLayout } from "@/lib/timeline/layout";
import type { TimelineTask } from "@/lib/queries/timeline";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { PRIORITY_COLORS } from "@/lib/task-colors";
import { cn } from "@/lib/utils";

export const MOVE_PREFIX = "timeline-move:";
export const RESIZE_START_PREFIX = "timeline-resize-start:";
export const RESIZE_END_PREFIX = "timeline-resize-end:";

export function TimelineBarDraggable({
  task,
  layout,
  workspaceSlug,
  canDrag,
}: {
  task: TimelineTask;
  layout: TimelineBarLayout;
  workspaceSlug: string;
  canDrag: boolean;
}) {
  const priorityColor = PRIORITY_COLORS[(task.priority as keyof typeof PRIORITY_COLORS) ?? "none"];
  const href = `/w/${workspaceSlug}/projects/${task.projectId}/board?taskId=${task.id}`;
  const taskKey = formatTaskKey(task.projectKey, task.number);
  const label = taskKey ? `${taskKey} ${task.title}` : task.title;

  // Destructured immediately at each hook's own call site -- mirrors
  // components/calendar/day-cell.tsx's `DraggableTaskChip` convention
  // exactly (`const { attributes, listeners, setNodeRef, ... } =
  // useDraggable(...)`), which also keeps every dnd-kit-returned value a
  // plain local binding rather than a `.property` access chased off a
  // held-onto hook-result object.
  const {
    attributes: moveAttributes,
    listeners: moveListeners,
    setNodeRef: setMoveNodeRef,
    transform: moveTransformRaw,
    isDragging: moveIsDragging,
  } = useDraggable({ id: `${MOVE_PREFIX}${task.id}`, disabled: !canDrag });
  const {
    attributes: resizeStartAttributes,
    listeners: resizeStartListeners,
    setNodeRef: setResizeStartNodeRef,
    isDragging: resizeStartIsDragging,
  } = useDraggable({
    id: `${RESIZE_START_PREFIX}${task.id}`,
    disabled: !canDrag || layout.kind !== "range",
  });
  const {
    attributes: resizeEndAttributes,
    listeners: resizeEndListeners,
    setNodeRef: setResizeEndNodeRef,
    isDragging: resizeEndIsDragging,
  } = useDraggable({
    id: `${RESIZE_END_PREFIX}${task.id}`,
    disabled: !canDrag || layout.kind !== "range",
  });

  const moveTransform = moveTransformRaw
    ? CSS.Translate.toString({ ...moveTransformRaw, y: 0 })
    : undefined;
  const anyDragging = moveIsDragging || resizeStartIsDragging || resizeEndIsDragging;

  return (
    <div
      ref={setMoveNodeRef}
      className={cn(
        "group absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden text-xs text-white shadow-sm transition-opacity hover:opacity-90",
        layout.kind === "range" ? "h-6 rounded-md" : "h-4 w-4 -translate-x-1/2 rounded-full",
        task.isDone && "opacity-60",
        canDrag && "cursor-grab active:cursor-grabbing",
      )}
      style={{
        left: `${layout.leftPx}px`,
        width: layout.kind === "range" ? `${layout.widthPx}px` : undefined,
        backgroundColor: priorityColor,
        transform: moveTransform,
        zIndex: anyDragging ? 30 : undefined,
      }}
      data-testid={layout.kind === "range" ? "timeline-bar" : "timeline-marker"}
      data-task-id={task.id}
      title={label}
      aria-label={label}
      {...(canDrag ? moveListeners : {})}
      {...moveAttributes}
    >
      {layout.kind === "range" ? (
        <>
          {canDrag ? (
            <div
              ref={setResizeStartNodeRef}
              data-testid="timeline-bar-resize-start"
              className="absolute left-0 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-40 group-hover:bg-black"
              // stopPropagation: the resize handle is nested inside the
              // whole-bar move region above -- without stopping the
              // pointerdown here it would bubble up and activate BOTH the
              // move draggable and this resize draggable from a single
              // pointer press, dnd-kit registers whichever sensor sees the
              // event first with no defined winner. Scoping the handle's
              // own drag to itself only is the standard "nested draggable
              // handle" pattern.
              onPointerDown={(event) => {
                event.stopPropagation();
                resizeStartListeners?.onPointerDown?.(event);
              }}
              {...resizeStartAttributes}
            />
          ) : null}
          <a href={href} className="flex-1 truncate px-1.5">
            <span className="truncate">{task.title}</span>
          </a>
          {canDrag ? (
            <div
              ref={setResizeEndNodeRef}
              data-testid="timeline-bar-resize-end"
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-40 group-hover:bg-black"
              onPointerDown={(event) => {
                event.stopPropagation();
                resizeEndListeners?.onPointerDown?.(event);
              }}
              {...resizeEndAttributes}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
