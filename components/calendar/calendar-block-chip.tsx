// Planner feature: one calendar block chip inside a day cell -- draggable
// (dnd-kit, same seam DraggableTaskChip in day-cell.tsx already
// establishes for tasks; block ids are prefixed "block:" on the wire so
// calendar-day-grid.tsx's single onDragEnd can tell a dropped block apart
// from a dropped task and route to updateCalendarBlock vs editTask) and
// clickable to open an edit/delete Popover (rename, retime, unlink,
// delete) via calendar-block-popover-form.tsx's shared form.

"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import {
  combineDateAndTime,
  formatBlockTimeRange,
  isoToLocalDateOnly,
  isoToLocalTime,
} from "@/lib/calendar/block-datetime";
import { getCalendarBlockDisplayColor } from "@/lib/calendar/block-colors";
import { isOwnBlock } from "@/lib/calendar/ownership";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarBlockPopoverForm,
  type CalendarBlockFormValues,
} from "@/components/calendar/calendar-block-popover-form";
import { cn } from "@/lib/utils";

export const CALENDAR_BLOCK_DRAG_PREFIX = "block:";

export function CalendarBlockChip({
  block,
  canDrag,
  currentUserId,
  onUpdate,
  onDelete,
}: {
  block: CalendarBlock;
  canDrag: boolean;
  /** F022 (AS-043): drag-to-move is only ever enabled for the block's own
   * owner -- `canDrag` alone (write permission) is not enough, same
   * pattern as F021's `canResize` gate in week-time-grid.tsx. Callers
   * pass the signed-in member's id; the actual `canDrag && isOwnBlock(...)`
   * check happens inline below so this is the single call site. */
  currentUserId: string;
  onUpdate: (
    blockId: string,
    values: {
      title: string;
      startsAt: string;
      endsAt: string;
      color: string;
      blockType: CalendarBlockFormValues["blockType"];
    },
  ) => Promise<void> | void;
  onDelete: (blockId: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  // F022 (AS-043): a block owned by another member cannot be dragged to a
  // new time -- gate the drag affordance on ownership, not just the
  // caller's general write permission.
  const canMove = canDrag && isOwnBlock(block, currentUserId);
  // F023 (AS-044/AS-045): a block owned by another member opens read-only
  // -- no save/delete affordance, matching the drag gate above.
  const isOwn = isOwnBlock(block, currentUserId);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${CALENDAR_BLOCK_DRAG_PREFIX}${block.id}`,
    disabled: !canMove,
  });

  const displayColor = getCalendarBlockDisplayColor(block.color);

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: `${displayColor}1a`,
    borderColor: displayColor,
    borderStyle: "solid",
    borderLeftWidth: "3px",
  };

  async function handleSubmit(values: CalendarBlockFormValues) {
    const dateOnly = isoToLocalDateOnly(block.startsAt);
    const startsAt = combineDateAndTime(dateOnly, values.startTime);
    const endsAt = combineDateAndTime(dateOnly, values.endTime);
    setPending(true);
    try {
      await onUpdate(block.id, {
        title: values.title,
        startsAt,
        endsAt,
        color: values.color,
        blockType: values.blockType,
      });
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setPending(true);
    try {
      await onDelete(block.id);
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...(canMove ? listeners : {})}
            type="button"
            data-testid={`calendar-block-chip-${block.id}`}
            data-draggable={canMove}
            className={cn(
              "flex min-w-0 items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left hover:brightness-95",
              canMove ? "cursor-grab active:cursor-grabbing" : "cursor-default",
            )}
            title={block.title}
          >
            {block.blockType === "client_presentation" && (
              <span aria-hidden className="shrink-0" title="Client presentation">
                🔴
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{block.title}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatBlockTimeRange(block.startsAt, block.endsAt)}
            </span>
          </button>
        }
      />
      <PopoverContent>
        <CalendarBlockPopoverForm
          initial={{
            title: block.title,
            startTime: isoToLocalTime(block.startsAt),
            endTime: isoToLocalTime(block.endsAt),
            color: block.color,
            blockType: block.blockType,
          }}
          submitLabel="Save"
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          pending={pending}
          isOwn={isOwn}
        />
      </PopoverContent>
    </Popover>
  );
}
