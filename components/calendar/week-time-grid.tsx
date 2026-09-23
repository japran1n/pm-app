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
// the month grid already uses -- one mutation path, two views.
//
// F015 (AS-033): the all-day task strip that used to render above the
// timed grid was removed by product decision -- tasks no longer appear in
// this view at all (they never fetch here either, see F016/AS-034).

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast as sonnerToast } from "sonner";

import type { CalendarWeekDay } from "@/lib/calendar/week-grid";
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
  blockColumnSplit,
  blockLayoutForDay,
  computeConflictRanges,
  dragRangeToTimes,
  pixelOffsetToTime,
} from "@/lib/calendar/time-grid-layout";
import { combineDateAndTime, formatBlockTimeRange } from "@/lib/calendar/block-datetime";
import { getCalendarBlockDisplayColor } from "@/lib/calendar/block-colors";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarBlockPopoverForm,
  type CalendarBlockFormValues,
} from "@/components/calendar/calendar-block-popover-form";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { isOwnBlock, isOwnColumn } from "@/lib/calendar/ownership";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function useNowTop(): number {
  const compute = () => {
    const now = new Date();
    return (now.getHours() * 60 + now.getMinutes()) * PX_PER_MINUTE;
  };
  const [top, setTop] = useState(compute);
  useEffect(() => {
    const id = setInterval(() => setTop(compute()), 60_000);
    return () => clearInterval(id);
  }, []);
  return top;
}

// UX (hover "+" to create): the hovered slot's own "HH:MM" label -- reuses
// the same pure `pixelOffsetToTime` snap the eventual drag-create commit
// uses, so the label always matches what a plain click-on-"+" would
// actually create.
function formatHalfHourLabel(topPx: number): string {
  const { hours, minutes } = pixelOffsetToTime(topPx);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// jsdom (our test environment) and a handful of older WebKit builds don't
// implement the Pointer Events capture methods at all -- guard every call
// so drag-to-create/resize degrade to "works, just without capture" there
// instead of throwing and aborting the gesture.
function safeSetPointerCapture(el: Element, pointerId: number) {
  if (typeof el.setPointerCapture === "function") {
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // Some browsers throw if the pointer already went away; ignore.
    }
  }
}

function safeReleasePointerCapture(el: Element, pointerId: number) {
  if (
    typeof el.hasPointerCapture === "function" &&
    typeof el.releasePointerCapture === "function" &&
    el.hasPointerCapture(pointerId)
  ) {
    try {
      el.releasePointerCapture(pointerId);
    } catch {
      // Ignore -- capture may already have been released implicitly.
    }
  }
}

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
  blocksByDate,
  workspaceSlug: _workspaceSlug,
  workspaceId,
  currentUserId,
  overlayBlocksByDate = [],
}: {
  days: CalendarWeekDay[];
  blocksByDate: Record<string, CalendarBlock[]>;
  workspaceSlug: string;
  workspaceId?: string;
  /** F020 (AS-046): the signed-in member's id, used via `isOwnBlock` to
   * gate drag/resize/edit affordances to the block's owner. F021 is the
   * first consumer (resize handles); F022-F024 follow the same pattern. */
  currentUserId: string;
  /** Overlay mode: one per-date block map for each ADDITIONAL person
   * overlaid on top of `blocksByDate`'s own person (so `blocksByDate` is
   * always "person 0" of the split, and this array holds people 1..N).
   * Every day column's width is split evenly among 1 + this array's length
   * people, and overlapping time ranges across DISTINCT people get a
   * subtle conflict stripe (see `computeConflictRanges`). Defaults to `[]`,
   * which keeps every existing single-person caller byte-identical to
   * before this prop existed -- `blockColumnSplit` returns `null` (no
   * inline left/right override) whenever the total person count is 1. */
  overlayBlocksByDate?: Record<string, CalendarBlock[]>[];
}) {
  // F135/F225/F234 pattern reused verbatim (see calendar-day-grid.tsx's
  // identical `canDrag` line): `null` (no provider in the tree) is
  // treated as permissive.
  const membership = useMembership();
  const canDrag = membership ? canWrite({ role: membership.role }) : true;

  const [blocksState, setBlocksState] = useState(blocksByDate);
  const [dragCreate, setDragCreate] = useState<DragCreateState | null>(null);
  // UX (hover "+" to create): a plain click anywhere on the empty grid
  // used to start a create-drag immediately (a zero-length drag still
  // produced a block via `dragRangeToTimes`'s own minimum-width
  // fallback), which meant an accidental single click silently created a
  // block. Creation now only ever starts from this explicit "+" trigger,
  // shown at the hovered half-hour slot with its own start time label --
  // the column's own `onPointerDown` (below) no longer starts a
  // create-drag at all, only the "+" button's `onPointerDown` does (and a
  // real drag from there still works exactly as before, since pointer
  // capture keeps the gesture alive through the same column handlers).
  const nowTop = useNowTop();
  const [hoveredSlot, setHoveredSlot] = useState<{ date: string; top: number } | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const [resizePreviewPx, setResizePreviewPx] = useState<number | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{
    date: string;
    startTime: string;
    endTime: string;
    // Top offset (px) within the day column of the gesture that created
    // this pending block -- used to anchor the popover to the actual
    // clicked/dragged spot in the grid (see `pendingCreateAnchor` below),
    // rather than an unpositioned, decoupled trigger element.
    anchorPx: number;
  } | null>(null);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const gridHeight = MINUTES_PER_DAY * PX_PER_MINUTE;
  const defaultScrollTop = DEFAULT_VISIBLE_START_HOUR * PX_PER_HOUR;

  // Overlay mode: `blocksState` (this component's own, editable person) is
  // always person 0; `overlayBlocksByDate` supplies the rest, read-only.
  const totalOverlayPeople = 1 + overlayBlocksByDate.length;

  // Set initial scroll position once on mount only. Inline ref callbacks
  // re-run on every render (new function identity each time) and would
  // reset the scroll position whenever any state changes.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = defaultScrollTop;
    }
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function offsetForEvent(date: string, clientY: number): number {
    const el = columnRefs.current[date];
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clientY - rect.top;
  }

  const HALF_HOUR_PX = PX_PER_HOUR / 2;

  // UX (hover "+" to create): tracks which half-hour slot the mouse is
  // currently over, snapped down to the slot's own top -- mouse-only
  // (not pointer events) since the "+" affordance is a hover-only,
  // pointing-device convenience; touch/stylus users still create blocks
  // via a real press-drag directly on the grid the same way they always
  // could (this hover overlay simply never appears for them).
  function handleColumnMouseMove(date: string, event: React.MouseEvent) {
    if (!canDrag || !workspaceId || dragCreate || resize) return;
    // Don't show the "add" slot indicator when the pointer is over an existing
    // block chip or its children (resize handles, time label, etc.) -- the
    // mousemove event bubbles up from those children to the column div, so
    // without this guard the "+" overlays on top of blocks the user is hovering.
    if ((event.target as HTMLElement).closest('[data-testid^="calendar-week-block-chip"]')) {
      setHoveredSlot(null);
      return;
    }
    const offset = offsetForEvent(date, event.clientY);
    const snappedTop = Math.floor(offset / HALF_HOUR_PX) * HALF_HOUR_PX;
    setHoveredSlot((current) =>
      current && current.date === date && current.top === snappedTop
        ? current
        : { date, top: snappedTop },
    );
  }

  function handleColumnMouseLeave(date: string) {
    setHoveredSlot((current) => (current?.date === date ? null : current));
  }

  // F024 (AS-047/AS-048/AS-049): infrastructure for M7's stacked
  // multi-person layout, where each grid column will belong to a
  // specific member. For today's single-column-per-day view every
  // column's `columnUserId` is always `currentUserId` (there's no other
  // user's column to render yet), so this guard has no visible effect
  // now -- but it's the same check F032's per-person columns will rely
  // on to keep create affordances off teammates' columns.
  function canCreateInColumn(columnUserId: string): boolean {
    return isOwnColumn(columnUserId, currentUserId);
  }

  function handleAddSlotPointerDown(date: string, columnUserId: string, event: React.PointerEvent) {
    // The "+" trigger sits above the column's own hour-line/block
    // children but is still a descendant of the column div, so this
    // pointerdown both starts the gesture AND (via bubbling, since
    // pointer capture retargets subsequent events but preserves the DOM
    // bubble path) keeps the column's existing onPointerMove/onPointerUp
    // handlers driving the rest of the same create-drag exactly as
    // before. The trigger stays mounted through the gesture (see its own
    // render condition) rather than unmounting on this same tick, so a
    // synthetic pointerup dispatched straight at it (tests) or a real
    // one from the OS still bubbles to the column's commit handler.
    handleColumnPointerDown(date, columnUserId, event);
  }

  function handleColumnPointerDown(date: string, columnUserId: string, event: React.PointerEvent) {
    if (!canDrag || !workspaceId) return;
    // AS-047/AS-048/AS-049: never start a create-drag (click OR
    // press-and-drag -- both funnel through this same handler) on a
    // column that isn't the signed-in member's own.
    if (!canCreateInColumn(columnUserId)) return;
    // If this pointerdown originated from inside an already-open popover's
    // own content (the create form, the edit form, or any of their
    // interactive controls -- inputs, selects, color swatches, the submit
    // button), don't start a drag-create gesture or steal pointer capture.
    // `PendingCreatePopover`/the edit popover are rendered as React children
    // of this same day-column div (so their floating-ui-positioned content
    // is still part of this element's DOM subtree even though it visually
    // renders elsewhere), and without this guard `setPointerCapture` below
    // re-targets the corresponding pointerup/click for that same gesture to
    // THIS column div instead of the actual button under the cursor,
    // meaning a real click on the popover's submit button never registers.
    if ((event.target as HTMLElement).closest('[data-slot="popover-content"]')) {
      return;
    }
    // Only start a create-drag on the empty grid surface itself, not on a
    // block chip (chips stop propagation in their own onPointerDown below).
    //
    // Pointer Events (rather than raw Mouse Events) cover mouse, touch, AND
    // stylus input through the SAME handler -- this is the minimal change
    // needed to make drag-to-create/resize work on tablet/mobile without
    // reaching for a heavier drag library (dnd-kit et al) just for this
    // view. `setPointerCapture` pins all subsequent pointermove/pointerup
    // events to THIS element regardless of where the finger/cursor
    // physically travels, so a fast touch-drag that strays outside the
    // column's bounding box doesn't silently drop the gesture the way a
    // plain mouseleave-based approach would.
    safeSetPointerCapture(event.currentTarget, event.pointerId);
    const offset = offsetForEvent(date, event.clientY);
    setDragCreate({ date, startPx: offset, currentPx: offset });
  }

  function handleGridPointerMove(event: React.PointerEvent) {
    if (dragCreate) {
      const offset = offsetForEvent(dragCreate.date, event.clientY);
      setDragCreate({ ...dragCreate, currentPx: offset });
    }
    if (resize) {
      // Live sync (per this feature's own spec): every pointermove while a
      // handle is held updates `resizePreviewPx`, which both `liveResize`
      // below (visual height/position) and the floating time label derive
      // from -- the block visibly tracks the pointer/finger in real time,
      // not only once at pointerup.
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

  function handleGridPointerUp(event: React.PointerEvent) {
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
    commitPointerGesture();
  }

  function commitPointerGesture() {
    if (dragCreate) {
      const { startTime, endTime } = dragRangeToTimes(dragCreate.startPx, dragCreate.currentPx);
      const anchorPx = Math.min(dragCreate.startPx, dragCreate.currentPx);
      const { date } = dragCreate;
      // Deferred to a macrotask: opening the popover synchronously inside
      // this same pointerup/click gesture races base-ui's own
      // outside-press dismiss listener, which (since the actual clicked
      // element is the grid cell, not the popover's own trigger/floating
      // element) sees this click as "outside" and immediately closes the
      // popover it just opened. Yielding to the next tick lets the click
      // that created this pending block finish before the popover (and
      // its dismiss listeners) mount.
      setTimeout(() => {
        setPendingCreate({ date, startTime, endTime, anchorPx });
      }, 0);
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
      blockType: values.blockType,
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
    values: {
      title: string;
      startsAt: string;
      endsAt: string;
      color: string;
      blockType: "general" | "client_presentation";
    },
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
    // `findBlock` is a plain per-render closure over `blocksState`, which
    // IS in the deps — listing the function itself would require a
    // useCallback wrapper for zero behavioral difference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resize, resizePreviewPx, blocksState]);

  return (
    <div className="flex flex-col gap-2" data-testid="calendar-week-time-grid">
      <div
        className="relative grid grid-cols-[3.5rem_repeat(7,1fr)] gap-px overflow-y-auto rounded-md border border-border/60"
        style={{ scrollPaddingTop: defaultScrollTop, maxHeight: "max(420px, calc(100svh - 200px))" }}
        ref={scrollRef}
        data-testid="calendar-week-scroll-region"
      >
        <div className="relative" style={{ height: gridHeight }}>
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="absolute left-0 right-0 border-t border-border/40 pr-1 text-right font-mono text-[10px] text-muted-foreground"
              style={{ top: hour * PX_PER_HOUR }}
            >
              {String(hour).padStart(2, "0")}:00
            </div>
          ))}
          {/* Current time dot on the left time-label column */}
          <div
            aria-hidden="true"
            className="absolute right-0 z-20 flex items-center justify-end pr-0.5"
            style={{ top: nowTop - 4 }}
          >
            <span className="size-2 rounded-full bg-destructive" />
          </div>
        </div>

        {days.map((day) => {
          // F024: today's `CalendarWeekDay` has no per-column owner (the
          // grid is always the signed-in member's own week), so this
          // defaults to `currentUserId`. M7's stacked layout is expected
          // to add a real `userId` to `CalendarWeekDay` per rendered
          // person-row; this fallback keeps today's behavior identical
          // once that lands.
          const columnUserId = day.userId ?? currentUserId;
          return (
          <div
            key={day.date}
            ref={(el) => {
              columnRefs.current[day.date] = el;
            }}
            data-testid={`calendar-week-column-${day.date}`}
            className={cn(
              "relative border-l border-border/40",
              // Previously a full-column-height `bg-primary/5` wash, which
              // (since --primary resolves to a dark gray, not a tint) read
              // as a solid gray rectangle behind every hour row and made
              // blocks/events inside today's column look washed out next
              // to the same blocks in other days' columns. A thin colored
              // top border matches how most calendar apps mark "today"
              // without touching the contrast of anything drawn on top.
              day.isToday && "border-t-2 border-t-primary",
            )}
            style={{ height: gridHeight, touchAction: "none" }}
            onPointerMove={handleGridPointerMove}
            onPointerUp={handleGridPointerUp}
            onPointerCancel={handleGridPointerUp}
            onMouseMove={(event) => handleColumnMouseMove(day.date, event)}
            onMouseLeave={() => handleColumnMouseLeave(day.date)}
          >
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 border-t border-border/20"
                style={{ top: hour * PX_PER_HOUR }}
              />
            ))}

            {/* Current time line — only on today's column */}
            {day.isToday && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-destructive"
                style={{ top: nowTop }}
              />
            )}

            {/* UX (hover "+" to create): only the hovered half-hour slot
                renders this trigger -- a plain click anywhere else on the
                column no longer opens the create popover (see
                handleColumnMouseMove's own doc comment above). Suppressed
                while a drag-create/resize/pending-create is already in
                flight for this column so it doesn't render on top of
                those. */}
            {canDrag &&
              workspaceId &&
              canCreateInColumn(columnUserId) &&
              hoveredSlot?.date === day.date &&
              !resize &&
              !(pendingCreate && pendingCreate.date === day.date) && (
                <button
                  type="button"
                  aria-label={`Add calendar block at ${formatHalfHourLabel(hoveredSlot.top)}`}
                  data-testid={`calendar-week-add-slot-${day.date}`}
                  className="absolute left-0.5 right-0.5 flex items-center gap-1 rounded border border-dashed border-primary/50 bg-primary/5 px-1 text-[10px] font-mono text-primary/80 hover:bg-primary/10"
                  style={{ top: hoveredSlot.top, height: HALF_HOUR_PX }}
                  onPointerDown={(event) => handleAddSlotPointerDown(day.date, columnUserId, event)}
                >
                  <Plus className="size-3 shrink-0" aria-hidden="true" />
                  {formatHalfHourLabel(hoveredSlot.top)}
                </button>
              )}

            {/* Overlay mode: a subtle red diagonal-stripe band behind the
                blocks themselves, painted only across time ranges where 2+
                DISTINCT people (this column's own person plus any
                overlaid ones) have overlapping blocks -- see
                `computeConflictRanges`'s own doc comment. No-op (empty
                array) whenever only one person is shown, i.e. every
                caller that doesn't pass `overlayBlocksByDate`. */}
            {totalOverlayPeople > 1 &&
              computeConflictRanges(
                [blocksState[day.date] ?? [], ...overlayBlocksByDate.map((m) => m[day.date] ?? [])],
                day.date,
              ).map((range, index) => (
                <div
                  key={`conflict-${day.date}-${index}`}
                  aria-hidden="true"
                  data-testid={`calendar-week-conflict-stripe-${day.date}`}
                  className="pointer-events-none absolute left-0 right-0 z-[5]"
                  style={{
                    top: range.top,
                    height: range.height,
                    backgroundImage:
                      "repeating-linear-gradient(-45deg, rgba(239,68,68,.04) 0px, rgba(239,68,68,.04) 4px, transparent 4px, transparent 10px)",
                  }}
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
                  columnSplit={blockColumnSplit(0, totalOverlayPeople)}
                  liveTimeLabel={isResizingThis ? liveResize!.label : null}
                  isResizing={isResizingThis}
                  canResize={canDrag && isOwnBlock(block, currentUserId)}
                  isOwn={isOwnBlock(block, currentUserId)}
                  onStartResize={(edge) =>
                    setResize({ blockId: block.id, edge, date: day.date })
                  }
                  onUpdate={(values) => handleUpdate(day.date, block.id, values)}
                  onDelete={() => handleDelete(day.date, block.id)}
                />
              );
            })}

            {/* Overlay mode: additional people's blocks, read-only (never
                the signed-in member's own -- `isOwn={false}` disables every
                edit/resize/delete affordance via the same
                `CalendarBlockPopoverForm` gate F023 already relies on for
                a teammate's block in the single-person view). */}
            {overlayBlocksByDate.map((overlayBlocks, overlayIndex) =>
              (overlayBlocks[day.date] ?? []).map((block) => {
                const layout = blockLayoutForDay(block.startsAt, block.endsAt, day.date);
                if (!layout) return null;
                return (
                  <WeekBlockChip
                    key={`overlay-${overlayIndex}-${block.id}`}
                    block={block}
                    date={day.date}
                    top={layout.top}
                    height={layout.height}
                    columnSplit={blockColumnSplit(overlayIndex + 1, totalOverlayPeople)}
                    canResize={false}
                    isOwn={false}
                    onStartResize={() => {}}
                    onUpdate={() => {}}
                    onDelete={() => {}}
                  />
                );
              }),
            )}

            {dragPreview && dragPreview.date === day.date && (
              <div
                className="pointer-events-none absolute left-0.5 right-0.5 rounded border border-dashed border-primary bg-primary/10"
                style={{ top: dragPreview.top, height: dragPreview.height }}
                data-testid="calendar-week-drag-preview"
              />
            )}

            {pendingCreate && pendingCreate.date === day.date && (
              <PendingCreatePopover
                pendingCreate={pendingCreate}
                onSubmit={handleCreate}
                onCancel={() => setPendingCreate(null)}
              />
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

function PendingCreatePopover({
  pendingCreate,
  onSubmit,
  onCancel,
}: {
  pendingCreate: { date: string; startTime: string; endTime: string; anchorPx: number };
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
      {/*
       * base-ui's Popover.Trigger requires (by default, via `nativeButton`)
       * that the element it renders is a real <button> -- passing a
       * `getBoundingClientRect`-only virtual object as `anchor` while the
       * trigger itself wasn't a real button caused the whole popover to
       * silently fail to render (plus a console warning). Rendering an
       * actual, invisible 1x1 <button> positioned absolutely at the exact
       * clicked/dragged spot inside this day's (already `relative`)
       * column, and letting the Positioner anchor to THAT real element
       * (the default anchor for a trigger, no explicit `anchor` prop
       * needed), satisfies base-ui's contract and reliably places the
       * popover at the clicked cell.
       */}
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="pointer-events-none absolute h-px w-px opacity-0"
            style={{ top: pendingCreate.anchorPx, left: 0 }}
          />
        }
      />
      <PopoverContent
        side="right"
        align="start"
        data-testid="calendar-week-create-popover"
      >
        <CalendarBlockPopoverForm
          initial={{
            title: "",
            startTime: pendingCreate.startTime,
            endTime: pendingCreate.endTime,
            blockType: "general",
          }}
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
  columnSplit = null,
  liveTimeLabel = null,
  isResizing = false,
  canResize,
  isOwn,
  onStartResize,
  onUpdate,
  onDelete,
}: {
  block: CalendarBlock;
  date: string;
  top: number;
  height: number;
  /** Overlay mode: this person's own `left`/`right` inset within the day
   * column, splitting it side-by-side with other overlaid people's chips.
   * `null` (the default, and always the value passed for the single-person
   * case) means "no override" -- the chip keeps its existing
   * `left-0.5 right-0.5` Tailwind classes below, unchanged. */
  columnSplit?: { left: string; right: string } | null;
  /** Live-synced "HH:MM - HH:MM" label shown WHILE a resize handle is
   * being dragged (before mouseup commits it) -- null the rest of the
   * time, when the chip's own static time range (below) is shown instead. */
  liveTimeLabel?: string | null;
  isResizing?: boolean;
  /** F021 (AS-042): gates the resize handles -- write permission alone
   * (`canDrag`) is not enough; a member with write access still must not
   * see resize handles on a teammate's block. Callers pass
   * `canDrag && isOwnBlock(block, currentUserId)`. */
  canResize: boolean;
  /** F023 (AS-044/AS-045): gates the popover to a read-only detail view
   * when false -- callers pass `isOwnBlock(block, currentUserId)`. */
  isOwn: boolean;
  onStartResize: (edge: "start" | "end") => void;
  onUpdate: (values: {
    title: string;
    startsAt: string;
    endsAt: string;
    color: string;
    blockType: "general" | "client_presentation";
  }) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const displayColor = getCalendarBlockDisplayColor(block.color);

  async function handleSubmit(values: CalendarBlockFormValues) {
    const startsAt = combineDateAndTime(date, values.startTime);
    const endsAt = combineDateAndTime(date, values.endTime);
    setPending(true);
    try {
      await onUpdate({
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
              "absolute left-0.5 right-0.5 flex flex-col overflow-hidden rounded border px-1 py-0.5 text-left text-[10px] hover:brightness-95",
              isResizing && "z-10 ring-1 ring-primary",
            )}
            style={{
              top,
              height,
              touchAction: "none",
              backgroundColor: `${displayColor}1a`,
              borderColor: displayColor,
              borderStyle: "solid",
              borderLeftWidth: "3px",
              // Overlay mode only -- `columnSplit` is `null` for every
              // single-person caller, leaving the `left-0.5 right-0.5`
              // classes above in full control, unchanged.
              ...(columnSplit ? { left: columnSplit.left, right: columnSplit.right } : {}),
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title={block.title}
          >
            {canResize && (
              <span
                data-testid={`calendar-week-resize-start-${block.id}`}
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                style={{ touchAction: "none" }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  safeSetPointerCapture(event.currentTarget, event.pointerId);
                  onStartResize("start");
                }}
              />
            )}
            <span className="truncate font-medium">
              {block.blockType === "client_presentation" && (
                <span aria-hidden title="Client presentation">
                  🔴{" "}
                </span>
              )}
              {block.title}
            </span>
            <span className="truncate text-muted-foreground" data-testid={`calendar-week-block-time-${block.id}`}>
              {/* Live sync during resize (this feature's own spec): the
                  displayed time range updates on every mousemove to the
                  exact snapped value the handle is currently over, so the
                  member sees precisely what they're about to commit
                  before releasing the mouse. */}
              {liveTimeLabel ?? formatBlockTimeRange(block.startsAt, block.endsAt)}
            </span>
            {canResize && (
              <span
                data-testid={`calendar-week-resize-end-${block.id}`}
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                style={{ touchAction: "none" }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  safeSetPointerCapture(event.currentTarget, event.pointerId);
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

function formatHHMMLocal(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

