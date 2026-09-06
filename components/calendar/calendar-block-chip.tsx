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
  onUpdate,
  onDelete,
}: {
  block: CalendarBlock;
  canDrag: boolean;
  onUpdate: (
    blockId: string,
    values: { title: string; startsAt: string; endsAt: string },
  ) => Promise<void> | void;
  onDelete: (blockId: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${CALENDAR_BLOCK_DRAG_PREFIX}${block.id}`,
    disabled: !canDrag,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  async function handleSubmit(values: CalendarBlockFormValues) {
    const dateOnly = isoToLocalDateOnly(block.startsAt);
    const startsAt = combineDateAndTime(dateOnly, values.startTime);
    const endsAt = combineDateAndTime(dateOnly, values.endTime);
    setPending(true);
    try {
      await onUpdate(block.id, { title: values.title, startsAt, endsAt });
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
            {...listeners}
            type="button"
            data-testid={`calendar-block-chip-${block.id}`}
            className={cn(
              "flex min-w-0 items-center gap-1 truncate rounded border border-dashed border-primary/50 bg-primary/5 px-1.5 py-0.5 text-left hover:bg-primary/10",
            )}
            title={block.title}
          >
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
          }}
          submitLabel="Save"
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          pending={pending}
        />
      </PopoverContent>
    </Popover>
  );
}
