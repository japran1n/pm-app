// F234 (AS-445): the one client-side "island" the month grid needs --
// owns the single DndContext for the whole calendar body (sensors, drag
// state -- same PointerSensor+KeyboardSensor pair board.tsx configures,
// for the identical reason: the keyboard sensor is required, not
// optional, for accessible dragging), and turns a drop into a real
// reschedule via the SAME `editTask` Server Action the task detail sheet's
// due-date field already uses (lib/actions/tasks.ts) -- never a parallel
// action, never a direct `due_date` write.
//
// Persists the exact seam month-grid.tsx's own doc comment anticipated:
// the grid body (day cells + their tasks) moved from a Server Component
// loop into this "use client" wrapper; the month header/nav (Links that
// flip "?month=") stays server-rendered in month-grid.tsx, untouched.
//
// Optimistic update + rollback + single toast: mirrors board.tsx's
// handleDragEnd convention exactly (see that file's own long comment on
// why the mutation call happens in the event handler's body, not inside a
// setState updater) -- the local `tasksByDate` copy is updated the
// instant the drop happens, and rolled back to the pre-drop snapshot with
// ONE `toast.error` if the action comes back `ok:false` or throws.
//
// Date correctness (this feature's core risk): the dropped-on cell's own
// id IS its real "YYYY-MM-DD" (day-cell.tsx's `useDroppable({ id:
// day.date })`) -- that string is passed to `editTask` completely
// unchanged, never round-tripped through `new Date(...)`, so the
// runtime's ambient timezone can never shift it by a day. A leading/
// trailing day from an adjacent month carries ITS OWN real date the same
// way (lib/calendar/month-grid.ts's `CalendarDay.date`), so dropping onto
// one sets that adjacent month's real date, never a date clamped into the
// visible month.
//
// Access control (this feature's clarified "no — it is pure; permission
// checks stay in the action layer" answer, and the spec's "permission
// varies per task across projects on this workspace-wide surface"): this
// component does NOT try to precompute per-project visibility/edit
// rights client-side (the calendar has no per-task project-role data to
// do that with, unlike the single-project board). It gates dragging on
// the caller's WORKSPACE role only (`canWrite`, same predicate/same
// `useMembership` fallback board.tsx uses) so a workspace viewer never
// gets an always-fails drag affordance -- exactly the class of case
// spec's "don't offer a drag that will always fail" is naming. A member
// who CAN write generally but lacks visibility into one specific task's
// private project still sees that chip as draggable; the drop is then
// rejected by editTask's own `isProjectVisibleToCaller` re-check (F322/
// F323's fix, reused here unmodified) and rolled back with a toast, same
// as any other server-side rejection -- this is what "enforce in the
// action, not by hiding UI" means for this surface.

"use client";

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";

import { toast as sonnerToast } from "sonner";

import { editTask } from "@/lib/actions/tasks";
import {
  createCalendarBlock,
  updateCalendarBlock,
  deleteCalendarBlock,
} from "@/lib/actions/calendar-blocks";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import type { CalendarDay } from "@/lib/calendar/month-grid";
import { planReschedule } from "@/lib/calendar/reschedule";
import { reconcileCalendarRealtimeEvent } from "@/lib/calendar/reconcile-realtime-task";
import type { CalendarTask } from "@/lib/queries/calendar";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import { moveIsoToDate, isoToLocalDateOnly } from "@/lib/calendar/block-datetime";
import type { DateOnly } from "@/lib/time/user-timezone";
import { DayCell } from "@/components/calendar/day-cell";
import { CALENDAR_BLOCK_DRAG_PREFIX } from "@/components/calendar/calendar-block-chip";
import { useCalendarRealtime } from "@/components/calendar/use-calendar-realtime";

export function CalendarDayGrid({
  days,
  tasksByDate,
  blocksByDate = {},
  workspaceSlug,
  workspaceId,
  projectIds,
}: {
  days: CalendarDay[];
  /** Plain serializable object -- the Server Component caller
   * (month-grid.tsx) converts its `Map<string, CalendarTask[]>` into this
   * shape before crossing the client-component boundary (a `Map` isn't a
   * serializable RSC prop). */
  tasksByDate: Record<string, CalendarTask[]>;
  /** Planner feature: same "Map -> plain object" conversion, keyed by the
   * block's own local calendar day. Optional so any existing test that
   * renders this component without blocks keeps working unchanged. */
  blocksByDate?: Record<string, CalendarBlock[]>;
  workspaceSlug: string;
  /** F009 (AS-019..AS-022): the current workspace's id (Realtime channel
   * scope) and the caller's own visible project id set (client-side
   * backstop gate for the DELETE-events-skip-RLS gap -- see
   * subscribe-calendar-realtime.ts's own doc comment). Optional so any
   * existing test that renders this component without them (pre-F009)
   * keeps working -- realtime is simply not subscribed without a
   * `workspaceId`. */
  workspaceId?: string;
  projectIds?: string[];
}) {
  const [byDate, setByDate] = useState(tasksByDate);
  const [blocksState, setBlocksState] = useState(blocksByDate);

  // F009 (AS-019, AS-020, AS-021, AS-022): live updates from other users
  // -- due-date changes, new dated tasks, and due-date removals/deletes --
  // land in this same `byDate` state the drag-and-drop optimistic update
  // (F234) already owns, via the shared pure reconciler.
  const visibleProjectIds = new Set(projectIds ?? []);
  // F040 (AS-022): scope realtime INSERT/UPDATE delivery to the currently
  // rendered grid's own date window (`days` already includes any leading/
  // trailing days from adjacent months, so `days[0]`/`days[last]` are the
  // true visible bounds) -- an event for a due_date outside this window
  // belongs to a month the caller isn't looking at right now.
  const visibleDateRange =
    days.length > 0
      ? { start: days[0].date, end: days[days.length - 1].date }
      : undefined;
  useCalendarRealtime({
    workspaceId: workspaceId ?? "",
    onDueDateChange: (event) => {
      setByDate((current) =>
        reconcileCalendarRealtimeEvent(
          current,
          event,
          visibleProjectIds,
          visibleDateRange,
        ),
      );
    },
  });

  // F135/F225 pattern reused verbatim (see board.tsx's identical
  // `canDrag` line): `null` (no provider in the tree, e.g. a test that
  // doesn't wrap this component in one) is treated as permissive.
  const membership = useMembership();
  const canDrag = membership ? canWrite({ role: membership.role }) : true;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor),
  );

  // Planner feature: create/update/delete for calendar_blocks, mirroring
  // the day-cell-local optimistic-update-then-persist shape this file's
  // task drag handler already uses, but scoped to `blocksState` instead
  // of `byDate`.
  function findBlockDate(blockId: string): string | null {
    for (const [date, blocks] of Object.entries(blocksState)) {
      if (blocks.some((b) => b.id === blockId)) return date;
    }
    return null;
  }

  async function handleCreateBlock(
    date: string,
    values: {
      title: string;
      startsAt: string;
      endsAt: string;
      color: string;
      blockType: "general" | "client_presentation";
    },
  ) {
    if (!workspaceId) return;
    const result = await createCalendarBlock({
      workspaceId,
      title: values.title,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      color: values.color,
      blockType: values.blockType,
    });
    if (!result.ok) {
      sonnerToast.error(result.error);
      return;
    }
    setBlocksState((current) => ({
      ...current,
      [date]: [...(current[date] ?? []), result.data],
    }));
  }

  async function handleUpdateBlock(
    blockId: string,
    values: {
      title: string;
      startsAt: string;
      endsAt: string;
      color: string;
      blockType: "general" | "client_presentation";
    },
  ) {
    const result = await updateCalendarBlock({
      blockId,
      title: values.title,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      color: values.color,
      blockType: values.blockType,
    });
    if (!result.ok) {
      sonnerToast.error(result.error);
      return;
    }
    const oldDate = findBlockDate(blockId);
    const newDate = isoToLocalDateOnly(values.startsAt);
    setBlocksState((current) => {
      const next = { ...current };
      if (oldDate) {
        next[oldDate] = (next[oldDate] ?? []).filter((b) => b.id !== blockId);
      }
      next[newDate] = [...(next[newDate] ?? []), result.data];
      return next;
    });
  }

  async function handleDeleteBlock(blockId: string) {
    const result = await deleteCalendarBlock({ blockId });
    if (!result.ok) {
      sonnerToast.error(result.error);
      return;
    }
    setBlocksState((current) => {
      const next: typeof current = {};
      for (const [date, blocks] of Object.entries(current)) {
        next[date] = blocks.filter((b) => b.id !== blockId);
      }
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const targetDate = String(over.id) as DateOnly;

    if (activeId.startsWith(CALENDAR_BLOCK_DRAG_PREFIX)) {
      const blockId = activeId.slice(CALENDAR_BLOCK_DRAG_PREFIX.length);
      const sourceDate = findBlockDate(blockId);
      if (!sourceDate || sourceDate === targetDate) return;
      const block = blocksState[sourceDate]?.find((b) => b.id === blockId);
      if (!block) return;

      const snapshot = blocksState;
      const newStartsAt = moveIsoToDate(block.startsAt, targetDate);
      const newEndsAt = moveIsoToDate(block.endsAt, targetDate);
      setBlocksState((current) => {
        const next = { ...current };
        next[sourceDate] = (next[sourceDate] ?? []).filter((b) => b.id !== blockId);
        next[targetDate] = [
          ...(next[targetDate] ?? []),
          { ...block, startsAt: newStartsAt, endsAt: newEndsAt },
        ];
        return next;
      });

      updateCalendarBlock({ blockId, startsAt: newStartsAt, endsAt: newEndsAt })
        .then((result) => {
          if (!result.ok) {
            setBlocksState(snapshot);
            sonnerToast.error(result.error);
          }
        })
        .catch(() => {
          setBlocksState(snapshot);
          sonnerToast.error(
            "Something went wrong moving that block. Please try again.",
          );
        });
      return;
    }

    const taskId = activeId;

    // F234 (AS-445): the pure planning step lives in lib/calendar/
    // reschedule.ts, unit-tested independently of React/dnd-kit/Supabase
    // -- `null` covers both "dragged task not found" and "dropped back on
    // its own current day" (a no-op, matching board.tsx's own "same
    // column/position" no-op convention for a drop that changes nothing).
    const plan = planReschedule(byDate, taskId, targetDate);
    if (!plan) return;

    const snapshot = byDate;
    setByDate(plan.nextTasksByDate);

    let rolledBack = false;
    function rollback(message: string) {
      if (rolledBack) return;
      rolledBack = true;
      setByDate(snapshot);
      toast.error(message);
    }

    editTask(taskId, { dueDate: targetDate })
      .then((result) => {
        if (!result.ok) {
          rollback(result.error);
        }
      })
      .catch(() => {
        rollback("Something went wrong rescheduling that task. Please try again.");
      });
  }

  return (
    <DndContext id="calendar-dnd-context" sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        className="grid grid-cols-7 border-l border-border/60"
        data-testid="calendar-day-grid"
      >
        {days.map((day) => (
          <DayCell
            key={day.date}
            day={day}
            tasks={byDate[day.date] ?? []}
            blocks={blocksState[day.date] ?? []}
            workspaceSlug={workspaceSlug}
            canDrag={canDrag}
            onCreateBlock={
              canDrag && workspaceId
                ? (values) => handleCreateBlock(day.date, values)
                : undefined
            }
            onUpdateBlock={canDrag ? handleUpdateBlock : undefined}
            onDeleteBlock={canDrag ? handleDeleteBlock : undefined}
          />
        ))}
      </div>
    </DndContext>
  );
}
