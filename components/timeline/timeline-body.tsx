// F238 (AS-454): the one client-side "island" the timeline's scroll body
// needs -- owns the single DndContext for whole-bar move + edge-resize,
// turns a drag end into a real reschedule via the SAME `editTask` Server
// Action the task detail sheet's start/due-date fields already use
// (lib/actions/tasks.ts) -- never a parallel action, never a direct
// `start_date`/`due_date` write. Mirrors
// components/calendar/calendar-day-grid.tsx (F234)'s own shape closely:
// one DndContext, local optimistic state, single-toast rollback.
//
// Date correctness (this feature's own flagged top risk): the pure
// planning step (lib/timeline/reschedule.ts) never touches a locally-
// constructed `Date` -- every value it returns is derived from the
// task's OWN real `startDate`/`dueDate` `DateOnly` strings shifted by a
// whole-day integer delta, so no ambient timezone can ever shift the
// value sent to `editTask` by a day. This component's own job is
// strictly: turn a dnd-kit `delta.x` into a day-count
// (`pixelDeltaToDayDelta`), hand it to the pure planner, and send
// whatever `DateOnly` strings the planner returns -- it never re-derives
// or reformats a date itself.
//
// Access control (this feature's clarified "controls are hidden or
// disabled ... the server still rejects the call" answer, and the
// spec's "permission varies per task across projects on this workspace-
// wide surface -- enforce in the action, not by hiding UI, and don't
// offer a drag that will always fail"): exactly the calendar's own
// precedent (F234) is followed here since this is the identical shape of
// surface (workspace-wide, many projects, no per-task project-role data
// available client-side to precompute per task) -- `canDrag` gates on
// the caller's WORKSPACE role only (`canEditTask`, the SAME predicate
// `editTask` itself re-checks server-side, per AS-230's "one predicate
// backs both UI gating and the server-side re-check"), never a per-
// project precomputation. A member who can edit tasks generally but
// lacks visibility into one specific task's private project still sees
// that bar as draggable; the drop is then rejected by editTask's own
// `isProjectVisibleToCaller` re-check (F322/F323's fix, reused
// unmodified) and rolled back with a toast, same as any other server-
// side rejection.

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

import { editTask } from "@/lib/actions/tasks";
import { canEditTask } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import type { DateOnly } from "@/lib/time/user-timezone";
import { computeBarLayout, DEFAULT_PIXELS_PER_DAY } from "@/lib/timeline/layout";
import {
  pixelDeltaToDayDelta,
  planTimelineBarMove,
  planTimelineBarResize,
} from "@/lib/timeline/reschedule";
import {
  MOVE_PREFIX,
  RESIZE_END_PREFIX,
  RESIZE_START_PREFIX,
  TimelineBarDraggable,
} from "@/components/timeline/timeline-bar-draggable";
import { TimelineRowTrack } from "@/components/timeline/timeline-scale";
import { formatTaskKey } from "@/lib/tasks/task-key";
import type { TimelineTask } from "@/lib/queries/timeline";

export type TimelineGroup = {
  projectId: string;
  projectName: string;
  tasks: TimelineTask[];
};

/** Per-task date overrides applied on top of the server-fetched `tasks`
 * prop -- the exact same "small local mirror, rolled back to a snapshot
 * on failure" shape `CalendarDayGrid`'s `byDate` state uses, just keyed
 * by task id with a `{startDate, dueDate}` pair instead of a date
 * bucket, since the timeline moves a task WITHIN the group it's already
 * rendered in rather than between rows. */
type DateOverrides = Record<string, { startDate: DateOnly | null; dueDate: DateOnly | null }>;

export function TimelineBody({
  groups,
  workspaceSlug,
  rangeStart,
  rangeEnd,
  today,
  pixelsPerDay = DEFAULT_PIXELS_PER_DAY,
}: {
  groups: TimelineGroup[];
  workspaceSlug: string;
  rangeStart: DateOnly;
  rangeEnd: DateOnly;
  today: DateOnly | null;
  pixelsPerDay?: number;
}) {
  const [overrides, setOverrides] = useState<DateOverrides>({});

  // F135/F225/F234 pattern reused verbatim: `null` (no provider in the
  // tree, e.g. a test that doesn't wrap this component in one) is
  // treated as permissive, same fallback CalendarDayGrid/board.tsx use.
  const membership = useMembership();
  const canDrag = membership ? canEditTask({ role: membership.role }) : true;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  function currentDatesFor(task: TimelineTask): { startDate: DateOnly | null; dueDate: DateOnly | null } {
    const override = overrides[task.id];
    return override ?? { startDate: task.startDate, dueDate: task.dueDate };
  }

  function applyAndSave(taskId: string, plan: { startDate: DateOnly | null; dueDate: DateOnly | null }) {
    const snapshot = overrides;
    setOverrides((prev) => ({ ...prev, [taskId]: plan }));

    let rolledBack = false;
    function rollback(message: string) {
      if (rolledBack) return;
      rolledBack = true;
      setOverrides(snapshot);
      toast.error(message);
    }

    editTask(taskId, { startDate: plan.startDate, dueDate: plan.dueDate })
      .then((result) => {
        if (!result.ok) rollback(result.error);
      })
      .catch(() => {
        rollback("Something went wrong rescheduling that task. Please try again.");
      });
  }

  function handleDragEnd(event: DragEndEvent) {
    const id = String(event.active.id);
    const deltaDays = pixelDeltaToDayDelta(event.delta.x, pixelsPerDay);
    if (deltaDays === 0) return;

    const allTasks = groups.flatMap((g) => g.tasks);

    if (id.startsWith(MOVE_PREFIX)) {
      const taskId = id.slice(MOVE_PREFIX.length);
      const task = allTasks.find((t) => t.id === taskId);
      if (!task) return;
      const dates = { id: task.id, ...currentDatesFor(task) };
      const plan = planTimelineBarMove(dates, deltaDays);
      if (!plan) return;
      applyAndSave(taskId, plan);
      return;
    }

    if (id.startsWith(RESIZE_START_PREFIX)) {
      const taskId = id.slice(RESIZE_START_PREFIX.length);
      const task = allTasks.find((t) => t.id === taskId);
      if (!task) return;
      const dates = { id: task.id, ...currentDatesFor(task) };
      const plan = planTimelineBarResize(dates, "start", deltaDays);
      if (!plan) return;
      applyAndSave(taskId, plan);
      return;
    }

    if (id.startsWith(RESIZE_END_PREFIX)) {
      const taskId = id.slice(RESIZE_END_PREFIX.length);
      const task = allTasks.find((t) => t.id === taskId);
      if (!task) return;
      const dates = { id: task.id, ...currentDatesFor(task) };
      const plan = planTimelineBarResize(dates, "end", deltaDays);
      if (!plan) return;
      applyAndSave(taskId, plan);
      return;
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {groups.map((group) => (
        <div key={group.projectId} className="flex flex-col">
          <div className="flex">
            <div className="sticky left-0 z-20 flex w-56 shrink-0 items-center border-b border-r bg-muted/40 px-3 py-2 text-sm font-medium">
              {group.projectName}
            </div>
            <div style={{ width: 0 }} />
          </div>
          {group.tasks.map((task) => {
            const dates = currentDatesFor(task);
            const effectiveTask: TimelineTask = { ...task, ...dates };
            const layout = computeBarLayout(effectiveTask, rangeStart, rangeEnd, pixelsPerDay);
            if (!layout) return null;
            return (
              <div key={task.id} className="flex">
                <div className="sticky left-0 z-20 flex w-56 shrink-0 items-center gap-1 truncate border-b border-r bg-background px-3 py-2 text-sm">
                  <span className="truncate">
                    {formatTaskKey(task.projectKey, task.number) ?? ""} {task.title}
                  </span>
                </div>
                <TimelineRowTrack rangeStart={rangeStart} rangeEnd={rangeEnd} today={today} pixelsPerDay={pixelsPerDay}>
                  <TimelineBarDraggable task={effectiveTask} layout={layout} workspaceSlug={workspaceSlug} canDrag={canDrag} />
                </TimelineRowTrack>
              </div>
            );
          })}
        </div>
      ))}
    </DndContext>
  );
}
