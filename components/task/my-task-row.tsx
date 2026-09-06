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
import { CircleDot, Eye } from "lucide-react";

import { formatTaskKey } from "@/lib/tasks/task-key";
import { formatDueDate } from "@/lib/time/user-timezone";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { ListPrioritySelect } from "@/components/task/list-priority-select";
import { MyTaskStatusCell } from "@/components/task/my-task-status-cell";
import type { TaskCardTask } from "@/components/task/task-card";
import type { MyTaskRow } from "@/lib/queries/my-tasks";
import type { MyTaskStatusOption } from "@/app/(workspace)/w/[workspaceSlug]/my-tasks/page";

export function MyTaskRowItem({
  row,
  workspaceSlug,
  timezone,
  statusOptions,
}: {
  row: MyTaskRow;
  workspaceSlug: string;
  timezone: string;
  statusOptions?: MyTaskStatusOption[];
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
        {key ?? "—"}
      </TableCell>
      <TableCell className="font-medium">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate">{row.title}</span>
          {/* AS-439: which project this task belongs to. */}
          <Badge variant="outline" className="shrink-0">
            {row.projectName}
          </Badge>
          {/* F231 (AS-441): visually distinguish a watched-only row (not
              assigned) from an assigned one — a task that is both
              assigned and watched shows only the assigned styling. */}
          {row.isWatched && !row.isAssigned && (
            <Badge variant="secondary" className="shrink-0">
              Watching
            </Badge>
          )}
          {row.clientVisible && (
            <span
              className="inline-flex shrink-0 items-center text-muted-foreground"
              data-testid="client-visible-indicator"
            >
              <Eye className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Client can see this task</span>
            </span>
          )}
          {row.pendingClientApproval && (
            <span
              className="inline-flex shrink-0 items-center text-amber-700"
              data-testid="awaiting-client-indicator"
            >
              <CircleDot className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Awaiting client decision</span>
            </span>
          )}
        </div>
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
      <TableCell className="text-right text-xs text-muted-foreground">
        {row.dueDate ? formatDueDate(row.dueDate, timezone) : "—"}
      </TableCell>
    </TableRow>
  );
}
