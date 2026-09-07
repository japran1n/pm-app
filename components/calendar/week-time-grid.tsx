// Week/Planner follow-up: the "real" Google-Calendar/ClickUp-style time
// grid the month view's own doc comments flagged as a follow-up (see
// add-block-popover.tsx's AUTONOMOUS_DECISION) -- 7 day columns over a
// vertical time axis, so a click-and-drag over empty grid space can create
// a block with a genuine pixel-derived start/end time (lib/calendar/
// time-grid-layout.ts's pure `dragRangeToTimes`), and an existing block's
// top/bottom edge can be dragged to resize it (`applyResize`) instead of
// only being retimed through the popover form.
//
// Live-synced resize: the block's own visual height/position is
// recomputed on EVERY mousemove while a resize handle is held (not just
// once at mouseup) via the `liveResize` memo below, using the exact same
// pure `applyResize`/`blockLayoutForDay` maths the mouseup commit uses --
// so what's on screen while dragging is never an approximation of the
// final result, and a floating "HH:MM - HH:MM" label tracks the resized
// edge the whole time so the member can see precisely what they're about
// to commit before releasing the mouse.
//
// Mirrors calendar-day-grid.tsx's ownership split: this client component
// owns the local optimistic `blocksState` copy and the create/update/
// delete calls into the SAME Server Actions (lib/actions/calendar-blocks)
// the month grid already uses -- one mutation path, two views. Dragging a
// task chip to reschedule is intentionally NOT reimplemented here (tasks
// carry no time-of-day at all -- `due_date` is a bare calendar date, see
// lib/queries/calendar.ts's own doc comment -- so a task is rendered as an
// all-day strip at the top of each day column, matching how Google
// Calendar itself renders all-day events above the timed grid); moving a
// task's DAY still goes through the month view's existing drag-to-move,
// which this view does not duplicate.

"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast as sonnerToast } from "sonner";

import type { CalendarWeekDay } from "@/lib/calendar/week-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import {
  createCalendarBlock,
  updateCalendarBlock,
  deleteCalendarBlock,
} from "@/lib/actions/calendar-blocks";
import {
  DEFAULT_VISIBLE_START_HOUR,
  MINUTES_PER_DAY,
  PX_PER_HOUR,
  PX_PER_MINUTE,
  applyResize,
  blockLayoutForDay,
  dragRangeToTimes,
} from "@/lib/calendar/time-grid-layout";
import { combineDateAndTime, formatBlockTimeRange } from "@/lib/calendar/block-datetime";
import { isKnownCalendarBlockColor } from "@/lib/calendar/block-colors";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarBlockPopoverForm,
  type CalendarBlockFormValues,
} from "@/components/calendar/calendar-block-popover-form";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

type DragCreateState = {
  date: string;
  startPx: number;
  currentPx: number;
};

type ResizeState = {
  blockId: string;
  edge: "start" | "end";
  date: string;
};

export function WeekTimeGrid({
  days,
  tasksByDate,
  blocksByDate,
  workspaceSlug,
  workspaceId,
}: {
  days: CalendarWeekDay[];
  tasksByDate: Record<string, CalendarTask[]>;
  blocksByDate: Record<string, CalendarBlock[]>;
  workspaceSlug: string;
  workspaceId?: string;
}) {
  // F135/F225/F234 pattern reused verbatim (see calendar-day-grid.tsx's
  // identical `canDrag` line): `null` (no provider in the tree) is
  // treated as permissive.
  const membership = useMembership();
  const canDrag = membership ? canWrite({ role: membership.role }) : true;

  const [blocksState, setBlocksState] = useState(blocksByDate);
  const [dragCreate, setDragCreate] = useState<DragCreateState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const [resizePreviewPx, setResizePreviewPx] = useState<number | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{
    date: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const gridHeight = MINUTES_PER_DAY * PX_PER_MINUTE;
  const defaultScrollTop = DEFAULT_VISIBLE_START_HOUR * PX_PER_HOUR;

  function offsetForEvent(date: string, clientY: number): number {
    const el = columnRefs.current[date];
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clientY - rect.top;
  }

  function handleColumnMouseDown(date: string, event: React.MouseEvent) {
    if (!canDrag || !workspaceId) return;
    // Only start a create-drag on the empty grid surface itself, not on a
    // block chip (chips stop propagation in their own onMouseDown below).
    const offset = offsetForEvent(date, event.clientY);
    setDragCreate({ date, startPx: offset, currentPx: offset });
  }

  function handleGridMouseMove(event: React.MouseEvent) {
    if (dragCreate) {
      const offset = offsetForEvent(dragCreate.date, event.clientY);
      setDragCreate({ ...dragCreate, currentPx: offset });
    }
    if (resize) {
      // Live sync (per this feature's own spec): every mousemove while a
      // handle is held updates `resizePreviewPx`, which both `liveResize`
      // below (visual height/position) and the floating time label derive
      // from -- the block visibly tracks the pointer in real time, not
      // only once at mouseup.
      setResizePreviewPx(offsetForEvent(resize.date, event.clientY));
    }
  }

  function findBlock(blockId: string): CalendarBlock | undefined {
    for (const blocks of Object.values(blocksState)) {
      const found = blocks.find((b) => b.id === blockId);
      if (found) return found;
    }
    return undefined;
  }

  function handleGridMouseUp() {
    if (dragCreate) {
      const { startTime, endTime } = dragRangeToTimes(dragCreate.startPx, dragCreate.currentPx);
      setPendingCreate({ date: dragCreate.date, startTime, endTime });
      setDragCreate(null);
      return;
    }
    if (resize && resizePreviewPx !== null) {
      const block = findBlock(resize.blockId);
      if (block) {
        const { startsAt, endsAt } = applyResize(
          resize.edge,
          block.startsAt,
          block.endsAt,
          resize.date,
          resizePreviewPx,
        );
        applyOptimisticResize(resize.date, resize.blockId, startsAt, endsAt);
      }
      setResize(null);
      setResizePreviewPx(null);
    }
  }

  function applyOptimisticResize(
    date: string,
    blockId: string,
    startsAt: string,
    endsAt: string,
  ) {
    const snapshot = blocksState;
    setBlocksState((current) => ({
      ...current,
      [date]: (current[date] ?? []).map((b) =>
        b.id === blockId ? { ...b, startsAt, endsAt } : b,
      ),
    }));
    updateCalendarBlock({ blockId, startsAt, endsAt })
      .then((result) => {
        if (!result.ok) {
          setBlocksState(snapshot);
          sonnerToast.error(result.error);
        }
      })
      .catch(() => {
        setBlocksState(snapshot);
        sonnerToast.error("Something went wrong resizing that block. Please try again.");
      });
  }

  async function handleCreate(values: CalendarBlockFormValues) {
    if (!pendingCreate || !workspaceId) return;
    const startsAt = combineDateAndTime(pendingCreate.date, values.startTime);
    const endsAt = combineDateAndTime(pendingCreate.date, values.endTime);
    const result = await createCalendarBlock({
      workspaceId,
      title: values.title,
      startsAt,
      endsAt,
      color: values.color,
    });
    if (!result.ok) {
      sonnerToast.error(result.error);
      return;
    }
    setBlocksState((current) => ({
      ...current,
      [pendingCreate.date]: [...(current[pendingCreate.date] ?? []), result.data],
    }));
    setPendingCreate(null);
  }

  async function handleUpdate(
    date: string,
    blockId: string,
    values: { title: string; startsAt: string; endsAt: string; color: string },
  ) {
    const result = await updateCalendarBlock({ blockId, ...values });
    if (!result.ok) {
      sonnerToast.error(result.error);
      return;
    }
    setBlocksState((current) => ({
      ...current,
      [date]: (current[date] ?? []).map((b) => (b.id === blockId ? result.data : b)),
    }));
  }

  async function handleDelete(date: string, blockId: string) {
    const result = await deleteCalendarBlock({ blockId });
    if (!result.ok) {
      sonnerToast.error(result.error);
      return;
    }
    setBlocksState((current) => ({
      ...current,
      [date]: (current[date] ?? []).filter((b) => b.id !== blockId),
    }));
  }

  const dragPreview = useMemo(() => {
    if (!dragCreate) return null;
    const top = Math.min(dragCreate.startPx, dragCreate.currentPx);
    const height = Math.max(Math.abs(dragCreate.currentPx - dragCreate.startPx), 4);
    return { date: dragCreate.date, top, height };
  }, [dragCreate]);

  // Live resize preview: recomputed on every mousemove (not just at
  // mouseup) so the block's own visual height/position is synced with the
  // pointer in real time, and a "HH:MM - HH:MM" label can be shown while
  // the handle is still being dragged -- both directly reuse the SAME
  // pure `applyResize` snap-to-15-minutes maths the eventual mouseup
  // commit uses, so what the user sees while dragging is exactly what
  // gets persisted, never an approximation.
  const liveResize = useMemo(() => {
    if (!resize || resizePreviewPx === null) return null;
    const block = findBlock(resize.blockId);
    if (!block) return null;
    const { startsAt, endsAt } = applyResize(
      resize.edge,
      block.startsAt,
      block.endsAt,
      resize.date,
      resizePreviewPx,
    );
    const layout = blockLayoutForDay(startsAt, endsAt, resize.date);
    if (!layout) return null;
    return {
      blockId: resize.blockId,
      date: resize.date,
      top: layout.top,
      height: layout.height,
      label: formatBlockTimeRange(startsAt, endsAt),
    };
  }, [resize, resizePreviewPx, blocksState]);

  return (
    <div className="flex flex-col gap-2" data-testid="calendar-week-time-grid">
      {/* All-day task row -- tasks carry no time-of-day (due_date only),
          so they render as a strip above the timed grid, matching how
          Google Calendar itself separates all-day events. */}
      <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] gap-px border-b border-border/60 pb-1">
        <div />
        {days.map((day) => (
          <div key={day.date} className="min-h-6 px-1" data-testid={`calendar-week-allday-${day.date}`}>
            {(tasksByDate[day.date] ?? []).map((task) => (
              <AllDayTaskChip key={task.id} task={task} workspaceSlug={workspaceSlug} />
            ))}
          </div>
        ))}
      </div>

      <div
        className="relative grid max-h-[36rem] grid-cols-[3.5rem_repeat(7,1fr)] gap-px overflow-y-auto rounded-md border border-border/60"
        style={{ scrollPaddingTop: defaultScrollTop }}
        ref={(el) => {
          if (el) el.scrollTop = defaultScrollTop;
        }}
        data-testid="calendar-week-scroll-region"
      >
        <div className="relative" style={{ height: gridHeight }}>
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="absolute left-0 right-0 border-t border-border/40 pr-1 text-right text-[10px] text-muted-foreground"
              style={{ top: hour * PX_PER_HOUR }}
            >
              {String(hour).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {days.map((day) => (
          <div
            key={day.date}
            ref={(el) => {
              columnRefs.current[day.date] = el;
            }}
            data-testid={`calendar-week-column-${day.date}`}
            className={cn(
              "relative border-l border-border/40",
              day.isToday && "bg-primary/5",
            )}
            style={{ height: gridHeight }}
            onMouseDown={(event) => handleColumnMouseDown(day.date, event)}
            onMouseMove={handleGridMouseMove}
            onMouseUp={handleGridMouseUp}
            onMouseLeave={() => {
              if (dragCreate?.date === day.date) setDragCreate(null);
            }}
          >
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 border-t border-border/20"
                style={{ top: hour * PX_PER_HOUR }}
              />
            ))}

            {(blocksState[day.date] ?? []).map((block) => {
              const layout = blockLayoutForDay(block.startsAt, block.endsAt, day.date);
              if (!layout) return null;
              const isResizingThis =
                liveResize !== null && liveResize.blockId === block.id && liveResize.date === day.date;
              return (
                <WeekBlockChip
                  key={block.id}
                  block={block}
                  date={day.date}
                  top={isResizingThis ? liveResize!.top : layout.top}
                  height={isResizingThis ? liveResize!.height : layout.height}
                  liveTimeLabel={isResizingThis ? liveResize!.label : null}
                  isResizing={isResizingThis}
                  canDrag={canDrag}
                  onStartResize={(edge) =>
                    setResize({ blockId: block.id, edge, date: day.date })
                  }
                  onUpdate={(values) => handleUpdate(day.date, block.id, values)}
                  onDelete={() => handleDelete(day.date, block.id)}
                />
              );
            })}

            {dragPreview && dragPreview.date === day.date && (
              <div
                className="pointer-events-none absolute left-0.5 right-0.5 rounded border border-dashed border-primary bg-primary/10"
                style={{ top: dragPreview.top, height: dragPreview.height }}
                data-testid="calendar-week-drag-preview"
              />
            )}
          </div>
        ))}
      </div>

      {pendingCreate && (
        <PendingCreatePopover
          pendingCreate={pendingCreate}
          onSubmit={handleCreate}
          onCancel={() => setPendingCreate(null)}
        />
      )}
    </div>
  );
}

function PendingCreatePopover({
  pendingCreate,
  onSubmit,
  onCancel,
}: {
  pendingCreate: { date: string; startTime: string; endTime: string };
  onSubmit: (values: CalendarBlockFormValues) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function handleSubmit(values: CalendarBlockFormValues) {
    setPending(true);
    try {
      await onSubmit(values);
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open onOpenChange={(open) => !open && onCancel()}>
      <PopoverTrigger render={<span className="sr-only" />} />
      <PopoverContent data-testid="calendar-week-create-popover">
        <CalendarBlockPopoverForm
          initial={{ title: "", startTime: pendingCreate.startTime, endTime: pendingCreate.endTime }}
          submitLabel="Add block"
          onSubmit={handleSubmit}
          pending={pending}
        />
      </PopoverContent>
    </Popover>
  );
}

function WeekBlockChip({
  block,
  date,
  top,
  height,
  liveTimeLabel = null,
  isResizing = false,
  canDrag,
  onStartResize,
  onUpdate,
  onDelete,
}: {
  block: CalendarBlock;
  date: string;
  top: number;
  height: number;
  /** Live-synced "HH:MM - HH:MM" label shown WHILE a resize handle is
   * being dragged (before mouseup commits it) -- null the rest of the
   * time, when the chip's own static time range (below) is shown instead. */
  liveTimeLabel?: string | null;
  isResizing?: boolean;
  canDrag: boolean;
  onStartResize: (edge: "start" | "end") => void;
  onUpdate: (values: { title: string; startsAt: string; endsAt: string; color: string }) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const hasColor = isKnownCalendarBlockColor(block.color);

  async function handleSubmit(values: CalendarBlockFormValues) {
    const startsAt = combineDateAndTime(date, values.startTime);
    const endsAt = combineDateAndTime(date, values.endTime);
    setPending(true);
    try {
      await onUpdate({ title: values.title, startsAt, endsAt, color: values.color });
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setPending(true);
    try {
      await onDelete();
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
            type="button"
            data-testid={`calendar-week-block-chip-${block.id}`}
            className={cn(
              "absolute left-0.5 right-0.5 flex flex-col overflow-hidden rounded border border-dashed border-primary/50 bg-primary/10 px-1 py-0.5 text-left text-[10px] hover:bg-primary/20",
              isResizing && "z-10 shadow-md ring-1 ring-primary",
            )}
            style={{
              top,
              height,
              ...(hasColor
                ? {
                    backgroundColor: `${block.color}1a`,
                    borderColor: block.color as string,
                    borderStyle: "solid",
                    borderLeftWidth: "3px",
                  }
                : {}),
            }}
            onMouseDown={(event) => event.stopPropagation()}
            title={block.title}
          >
            {canDrag && (
              <span
                data-testid={`calendar-week-resize-start-${block.id}`}
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onStartResize("start");
                }}
              />
            )}
            <span className="truncate font-medium">{block.title}</span>
            <span className="truncate text-muted-foreground" data-testid={`calendar-week-block-time-${block.id}`}>
              {/* Live sync during resize (this feature's own spec): the
                  displayed time range updates on every mousemove to the
                  exact snapped value the handle is currently over, so the
                  member sees precisely what they're about to commit
                  before releasing the mouse. */}
              {liveTimeLabel ?? formatBlockTimeRange(block.startsAt, block.endsAt)}
            </span>
            {canDrag && (
              <span
                data-testid={`calendar-week-resize-end-${block.id}`}
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onStartResize("end");
                }}
              />
            )}
          </button>
        }
      />
      <PopoverContent>
        <CalendarBlockPopoverForm
          initial={{
            title: block.title,
            startTime: formatHHMMLocal(block.startsAt),
            endTime: formatHHMMLocal(block.endsAt),
            color: block.color,
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

function formatHHMMLocal(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function AllDayTaskChip({
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
        "mb-1 flex min-w-0 items-center gap-1 truncate rounded border border-border/60 bg-card px-1.5 py-0.5 text-xs hover:bg-muted/60",
        task.isDone && "opacity-60 line-through",
      )}
      title={task.title}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: PRIORITY_COLORS[priority] }}
        aria-hidden="true"
      />
      <span className="sr-only">{PRIORITY_LABELS[priority]}</span>
      {key && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{key}</span>}
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
    </Link>
  );
}
