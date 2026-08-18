// F053 (AS-085): the project List view — all non-deleted tasks in a
// project rendered as a shadcn Table with title, status, priority,
// assignee, and due date columns.
//
// Plain Server Component (no "use client"): rendering a static table from
// already-fetched rows needs no client interactivity, and the clarified
// spec's "primary content server-rendered in initial HTML" (AS-155)
// requirement is satisfied for free by keeping this server-only. Filters
// (AS-086..090), sort (AS-091), and inline status editing (AS-093) are
// separate assertions/features layered on top later — this component only
// covers AS-085's "show the columns" requirement.
//
// Status/priority are shown as Badge (color) + text label together, never
// color alone, matching AS-153's rule (already followed by BoardColumn's
// COLUMN_LABELS and TaskCard's PRIORITY_LABELS) even though AS-153 itself
// isn't this feature's assigned assertion — no reason to regress it here.

import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { isOverdue } from "@/lib/tasks/is-overdue";
import type { TaskCardTask } from "@/components/task/task-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_LABELS: Record<TaskCardTask["status"], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

const PRIORITY_LABELS: Record<NonNullable<TaskCardTask["priority"]>, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  backlog: "Backlog",
};

function formatDueDate(dueDate: string): string {
  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return dueDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function TaskListTable({
  tasks,
  assigneeNames,
}: {
  tasks: TaskCardTask[];
  /** taskAssigneeId -> display name, resolved server-side (F053). */
  assigneeNames: Map<string, string>;
}) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No tasks yet in this project.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Assignee</TableHead>
          <TableHead>Due date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => {
          const overdue = isOverdue(task.dueDate, task.status);
          const assigneeName = task.assigneeId
            ? assigneeNames.get(task.assigneeId)
            : null;

          return (
            <TableRow key={task.id} data-task-id={task.id}>
              <TableCell className="font-medium">{task.title}</TableCell>
              <TableCell>
                <Badge variant="outline">{STATUS_LABELS[task.status]}</Badge>
              </TableCell>
              <TableCell>
                {task.priority ? (
                  <Badge variant="secondary">
                    {PRIORITY_LABELS[task.priority]}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {assigneeName ?? (
                  <span className="text-xs text-muted-foreground">
                    Unassigned
                  </span>
                )}
              </TableCell>
              <TableCell>
                {task.dueDate ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      overdue
                        ? "font-medium text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {overdue && (
                      <TriangleAlert className="size-3" aria-hidden="true" />
                    )}
                    <span className={overdue ? "sr-only" : "hidden"}>
                      Overdue:
                    </span>
                    {formatDueDate(task.dueDate)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
