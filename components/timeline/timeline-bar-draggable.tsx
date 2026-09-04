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
// `KeyboardSensor` makes any `useDraggable` region keyboard-operable
// (arrow keys move the DOM transform by its default coordinate getter's
// step) via its `onKeyDown` activator -- the SAME sensor pair
// components/calendar/calendar-day-grid.tsx (F234) and
// components/board/board.tsx already register. The whole-bar move
// region gets this for free by spreading `moveListeners` wholesale. The
// two resize handles are nested inside that move region and only spread
// `resize*Attributes` (tabIndex/role) plus a hand-rolled `onPointerDown`
// that stops propagation to avoid double-activating both draggables from
// one pointer press -- `onKeyDown` has to be wired the same deliberate
// way (stopPropagation, then delegate to `resize*Listeners.onKeyDown`)
// or the handle is keyboard-focusable but keyboard-inert.
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
import { PRIORITY_COLORS, PRIORITY_LABELS, PRIORITY_TEXT_ON_COLOR } from "@/lib/task-colors";
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
  const priority = (task.priority as keyof typeof PRIORITY_COLORS) ?? "none";
  const priorityColor = PRIORITY_COLORS[priority];
  const priorityLabel = PRIORITY_LABELS[priority];
  const priorityTextColor = PRIORITY_TEXT_ON_COLOR[priority];
  const href = `/w/${workspaceSlug}/projects/${task.projectId}/board?taskId=${task.id}`;
  const taskKey = formatTaskKey(task.projectKey, task.number);
  // AS-525/AS-526: mirrors components/timeline/timeline-bar.tsx's fix --
  // priority is folded into the accessible name/title (this component
  // renders no other priority-bearing text either, including the
  // no-visible-text marker branch), and the fixed-hex text colour is
  // picked per-background via PRIORITY_TEXT_ON_COLOR rather than a
  // hardcoded `text-white` that fails 4.5:1 for urgent/high/low.
  const label = taskKey
    ? `${taskKey} ${task.title} (${priorityLabel} priority)`
    : `${task.title} (${priorityLabel} priority)`;

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
        "group absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden text-xs shadow-sm transition-opacity hover:opacity-90",
        layout.kind === "range" ? "h-6 rounded-md" : "h-4 w-4 -translate-x-1/2 rounded-full",
        task.isDone && "opacity-60",
        canDrag && "cursor-grab active:cursor-grabbing",
      )}
      style={{
        left: `${layout.leftPx}px`,
        width: layout.kind === "range" ? `${layout.widthPx}px` : undefined,
        backgroundColor: priorityColor,
        color: priorityTextColor,
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
              aria-label={`Resize ${label} start date`}
              className="absolute left-0 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-40 group-hover:bg-black"
              // stopPropagation: the resize handle is nested inside the
              // whole-bar move region above -- without stopping the
              // pointerdown/keydown here it would bubble up and activate
              // BOTH the move draggable and this resize draggable from a
              // single pointer press or key press, dnd-kit registers
              // whichever sensor sees the event first with no defined
              // winner. Scoping the handle's own drag to itself only is
              // the standard "nested draggable handle" pattern.
              onPointerDown={(event) => {
                event.stopPropagation();
                resizeStartListeners?.onPointerDown?.(event);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                resizeStartListeners?.onKeyDown?.(event);
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
              aria-label={`Resize ${label} end date`}
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-40 group-hover:bg-black"
              onPointerDown={(event) => {
                event.stopPropagation();
                resizeEndListeners?.onPointerDown?.(event);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                resizeEndListeners?.onKeyDown?.(event);
              }}
              {...resizeEndAttributes}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
