"use client";

// Portal-parity fix ("My Tasks should look like Dashboard"): My Tasks
// previously rendered each row as a bespoke flex-wrap <div> (different
// height, spacing, and badge styling than the shared <TaskListTable> row
// used by both the per-project List view and the workspace Dashboard
// table). This renders each row inside the SAME shadcn <Table>/<TableRow>/
// <TableCell> primitives TaskListTable itself uses, with the SAME
// "click anywhere on the row except an interactive control" pattern
// (components/task/task-list-table.tsx's own TableRow onClick + per-cell
// stopPropagation convention) so a row here looks and behaves consistently
// with every other task row in the app.
//
// My Tasks navigates to the task's own project board (rather than opening
// TaskDetailSheet in place) — same destination the previous row's <Link>
// already used — since this page has no single project's worth of
// TaskDetailSheet plumbing (members/comments/attachments) to reuse across
// rows that can each belong to a different project.
//
// Priority is rendered with <ListPrioritySelect> (F250) — the SAME inline
// editable priority control TaskListTable's own Priority column uses —
// rather than the previous static Badge, for genuine visual+behavioural
// parity, not just a lookalike.

import { useRouter } from "next/navigation";

import { formatTaskKey } from "@/lib/tasks/task-key";
import { formatDuration } from "@/lib/time/format-duration";
import { formatDueDate } from "@/lib/time/user-timezone";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { ListPrioritySelect } from "@/components/task/list-priority-select";
import { ListTaskTypeSelect } from "@/components/task/list-task-type-select";
import { MyTaskStatusCell } from "@/components/task/my-task-status-cell";
// Same shared key/title cell markup TaskListTable itself uses (Dashboard +
// Project List) — see task-title-cell.tsx's own doc comment for why this
// is genuine reuse rather than two independently hand-matched components.
import { TaskKeyCell, TaskTitleCell } from "@/components/task/task-title-cell";
import type { TaskCardTask } from "@/components/task/task-card";
import type { MyTaskRow } from "@/lib/queries/my-tasks";
import type { MyTaskStatusOption } from "@/app/(workspace)/w/[workspaceSlug]/my-tasks/page";

export function MyTaskRowItem({
  row,
  workspaceSlug,
  timezone,
  statusOptions,
  taskTypeOptions = [],
}: {
  row: MyTaskRow;
  workspaceSlug: string;
  timezone: string;
  statusOptions?: MyTaskStatusOption[];
  /** Portal-parity fix (Type column): the workspace's task types, same
   * shape/source (getTaskTypes) TaskListTable's own taskTypeOptions prop
   * uses — see that component's own comment for the "empty means the
   * feature quietly steps aside" convention this follows too. */
  taskTypeOptions?: { id: string; name: string; color: string; systemKey?: string | null }[];
}) {
  const router = useRouter();
  const key = formatTaskKey(row.projectKey, row.number);
  const href = `/w/${workspaceSlug}/projects/${row.projectId}/board?taskId=${row.id}`;

  return (
    <TableRow
      data-task-id={row.id}
      role="button"
      tabIndex={0}
      className="cursor-pointer"
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(href);
        }
      }}
    >
      <TableCell className="font-mono text-xs text-muted-foreground">
        <TaskKeyCell taskKey={key} />
      </TableCell>
      <TableCell className="font-medium">
        <TaskTitleCell
          title={row.title}
          clientVisible={row.clientVisible}
          pendingClientApproval={row.pendingClientApproval}
          trailing={
            <>
              {/* AS-439: which project this task belongs to. */}
              <Badge variant="outline" className="shrink-0">
                {row.projectName}
              </Badge>
              {/* F231 (AS-441): visually distinguish a watched-only row
                  (not assigned) from an assigned one — a task that is
                  both assigned and watched shows only the assigned
                  styling. */}
              {row.isWatched && !row.isAssigned && (
                <Badge variant="secondary" className="shrink-0">
                  Watching
                </Badge>
              )}
            </>
          }
        />
      </TableCell>
      {/* stopPropagation: same convention as TaskListTable's Status
          cell — interacting with the dropdown changes status, it doesn't
          also navigate away from this page. */}
      <TableCell onClick={(event) => event.stopPropagation()}>
        <MyTaskStatusCell
          taskId={row.id}
          status={row.status as TaskCardTask["status"]}
          statusOptions={statusOptions}
        />
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <ListPrioritySelect
          taskId={row.id}
          priority={row.priority as TaskCardTask["priority"]}
        />
      </TableCell>
      {/* Portal-parity fix (Type column): same <ListTaskTypeSelect> cell
          TaskListTable's own Type column uses. */}
      <TableCell onClick={(event) => event.stopPropagation()}>
        <ListTaskTypeSelect
          taskId={row.id}
          taskType={row.taskType}
          options={taskTypeOptions}
        />
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-muted-foreground">
        {row.dueDate ? formatDueDate(row.dueDate, timezone) : "—"}
      </TableCell>
      {/* Portal-parity fix (Estimate/Logged columns): identical "—" for
          no estimate / plain formatDuration rendering TaskListTable's own
          Estimate/Logged cells use — see that component's own comment. */}
      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        {row.estimateMinutes ? formatDuration(row.estimateMinutes) : "—"}
      </TableCell>
      <TableCell
        className={
          row.estimateMinutes && row.totalMinutes > row.estimateMinutes
            ? "text-right font-mono text-xs tabular-nums text-destructive"
            : "text-right font-mono text-xs tabular-nums text-muted-foreground"
        }
      >
        {row.totalMinutes ? formatDuration(row.totalMinutes) : "—"}
      </TableCell>
    </TableRow>
  );
}
