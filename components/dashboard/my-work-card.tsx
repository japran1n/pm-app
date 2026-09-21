"use client";

// F007 (AS-030..AS-036): the Home dashboard's "My work" card — the
// caller's own overdue/today/this-week tasks in one place, capped at 8
// rows total so the card never grows unbounded, with a lightweight
// checkbox to mark a row done and a play/stop button to start/stop time
// tracking on it without leaving the dashboard.
//
// Client Component: the checkbox needs an optimistic flip (AS-035) and the
// timer button needs to know which task (if any) currently has the
// caller's active timer running (`activeTimerTaskId`) — both are
// interaction state, not something a Server Component can own.
//
// Status is rendered as a read-only <StatusBadge> pill (AS-034), never an
// editable dropdown like <ListStatusSelect>/<MyTaskStatusCell> use
// elsewhere — this card is a glanceable summary, not a task-management
// surface; the existing My Tasks page (and the task's own board) already
// own the full editable status control.
//
// AUTONOMOUS_DECISION: the clarified spec's prop is named
// `doneStatusIdByProject: Record<string, string>`, but the existing status
// mutation this card must reuse (`moveTaskStatus(taskId, newStatus)`,
// lib/actions/tasks/ordering.ts) takes a project's real `project_statuses`
// column NAME (e.g. "done"), never a `status_id` uuid — see F221/AS-409's
// doc comment on that action, and `MyTaskStatusOption.value` (the My Tasks
// page's own status-options type) carrying a name for the exact same
// reason. There is no numeric-id variant of this action. Kept the prop's
// name from the spec verbatim (so callers wiring page.tsx match the spec
// literally) but treat each map value as the done-category STATUS NAME to
// pass straight into `moveTaskStatus`, not a database id.
//
// AUTONOMOUS_DECISION: the clarified spec names `startTimeEntry`/
// `stopTimeEntry` as the actions to call, but the real exports (lib/
// actions/time-entries.ts) are `startTimer(taskId)` and `stopTimer()` (no
// args — it looks up the caller's own active_timers row server-side) —
// same substitution already made and documented in today-time-card.tsx's
// own header comment for this same spec-vs-code action-name mismatch.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";

import { moveTaskStatus } from "@/lib/actions/tasks/ordering";
import { startTimer, stopTimer } from "@/lib/actions/time-entries";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { STATUS_COLORS, statusLabelFor } from "@/lib/task-colors";
import type { MyTaskRow } from "@/lib/queries/my-tasks";
import type { TaskCardTask } from "@/components/task/task-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";

const MAX_ROWS = 8;

export type MyWorkCardProps = {
  overdue: MyTaskRow[];
  today: MyTaskRow[];
  thisWeek: MyTaskRow[];
  workspaceSlug: string;
  /** projectId -> the done-category status NAME to pass to
   * `moveTaskStatus` when the checkbox on a row from that project is
   * checked — see this file's own AUTONOMOUS_DECISION header comment for
   * why this carries a status name rather than a literal uuid despite the
   * prop's name. */
  doneStatusIdByProject: Record<string, string>;
  /** The task id (if any) that currently has the caller's active timer
   * running, so this card's play button can render as a stop button for
   * that one row. */
  activeTimerTaskId?: string;
};

type Group = {
  key: "overdue" | "today" | "thisWeek";
  label: string;
  headerClassName: string;
  rows: MyTaskRow[];
};

function statusColorFor(status: string): string {
  return STATUS_COLORS[status as TaskCardTask["status"]] ?? "#64748b";
}

function formatDueDateShort(dueDate: string | null): string {
  if (!dueDate) return "—";
  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MyWorkRow({
  row,
  workspaceSlug,
  doneStatusIdByProject,
  activeTimerTaskId,
}: {
  row: MyTaskRow;
  workspaceSlug: string;
  doneStatusIdByProject: Record<string, string>;
  activeTimerTaskId?: string;
}) {
  const router = useRouter();
  const [optimisticDone, setOptimisticDone] = React.useState(row.isDone);
  const [isTogglingStatus, setIsTogglingStatus] = React.useState(false);
  const [isTogglingTimer, setIsTogglingTimer] = React.useState(false);

  const isRunning = activeTimerTaskId === row.id;
  const key = formatTaskKey(row.projectKey, row.number);
  const taskHref = `/w/${workspaceSlug}/projects/${row.projectId}/board?taskId=${row.id}`;

  function handleCheckboxToggle() {
    const doneStatus = doneStatusIdByProject[row.projectId];
    if (!doneStatus || isTogglingStatus) return;

    const previous = optimisticDone;
    // AS-035: flip immediately, before the server confirms — revert on
    // failure, same optimistic-then-revert convention
    // PersonalTodoList's checkbox already uses (F006, AS-012/013/014).
    setOptimisticDone(true);
    setIsTogglingStatus(true);

    moveTaskStatus(row.id, doneStatus)
      .then((result) => {
        if (!result.ok) {
          setOptimisticDone(previous);
          toast.error(result.error);
          return;
        }
        router.refresh();
      })
      .catch(() => {
        setOptimisticDone(previous);
        toast.error("Something went wrong. Please try again.");
      })
      .finally(() => setIsTogglingStatus(false));
  }

  function handleTimerToggle() {
    if (isTogglingTimer) return;
    setIsTogglingTimer(true);

    const request = isRunning ? stopTimer() : startTimer(row.id);

    request
      .then((result) => {
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(isRunning ? "Timer stopped." : "Timer started.");
        router.refresh();
      })
      .catch(() => toast.error("Something went wrong. Please try again."))
      .finally(() => setIsTogglingTimer(false));
  }

  return (
    <div
      data-testid="my-work-row"
      data-task-id={row.id}
      className="flex items-center gap-3 border-b border-border/60 py-2 last:border-b-0"
    >
      <Checkbox
        aria-label={`Mark "${row.title}" done`}
        checked={optimisticDone}
        disabled={isTogglingStatus || !doneStatusIdByProject[row.projectId]}
        onClick={handleCheckboxToggle}
      />
      <Link
        href={taskHref}
        className="min-w-0 flex-1 gap-3 sm:flex sm:items-center"
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {key}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="truncate text-sm">{row.title}</span>
          <span className="block truncate text-xs text-muted-foreground sm:inline sm:before:content-['_·_']">
            {row.projectName}
          </span>
        </span>
      </Link>
      <StatusBadge
        label={statusLabelFor(row.status)}
        color={statusColorFor(row.status)}
        data-testid="my-work-status-badge"
      />
      <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {formatDueDateShort(row.dueDate)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-7 shrink-0"
        aria-label={isRunning ? "Stop timer" : "Start timer"}
        disabled={isTogglingTimer}
        onClick={handleTimerToggle}
      >
        {isRunning ? (
          <Square className="size-3" aria-hidden="true" />
        ) : (
          <Play className="size-3" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

export function MyWorkCard({
  overdue,
  today,
  thisWeek,
  workspaceSlug,
  doneStatusIdByProject,
  activeTimerTaskId,
}: MyWorkCardProps) {
  const total = overdue.length + today.length + thisWeek.length;

  const groups: Group[] = [
    {
      key: "overdue",
      label: "Overdue",
      headerClassName: "text-destructive",
      rows: overdue,
    },
    {
      key: "today",
      label: "Today",
      headerClassName: "text-foreground",
      rows: today,
    },
    {
      key: "thisWeek",
      label: "This week",
      headerClassName: "text-muted-foreground",
      rows: thisWeek,
    },
  ];

  let remaining = MAX_ROWS;
  const visibleGroups = groups.map((group) => {
    const visibleRows = remaining > 0 ? group.rows.slice(0, remaining) : [];
    remaining -= visibleRows.length;
    return { ...group, rows: visibleRows };
  });

  const surplus = total - Math.min(total, MAX_ROWS);

  return (
    <Card data-testid="my-work-card">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          My work
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {total === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="my-work-empty-state"
          >
            You&apos;re all clear — nothing due soon.
          </p>
        ) : (
          <>
            {visibleGroups.map((group) =>
              group.rows.length === 0 ? null : (
                <div key={group.key} data-testid={`my-work-group-${group.key}`}>
                  <div
                    className={`mb-1.5 flex items-center gap-2 text-xs font-medium ${group.headerClassName}`}
                  >
                    <span>{group.label}</span>
                    <span className="text-muted-foreground">
                      {group.rows.length}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    {group.rows.map((row) => (
                      <MyWorkRow
                        key={row.id}
                        row={row}
                        workspaceSlug={workspaceSlug}
                        doneStatusIdByProject={doneStatusIdByProject}
                        activeTimerTaskId={activeTimerTaskId}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
            {surplus > 0 && (
              <Link
                href={`/w/${workspaceSlug}/my-tasks`}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                data-testid="my-work-show-more"
              >
                Show {surplus} more → My Tasks
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
