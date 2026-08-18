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
//
// F057 (AS-093): the Status cell renders <ListStatusSelect>, a small
// Client Component wrapping a shadcn Select, instead of the static Badge
// used for the other columns. This table stays a Server Component overall
// (AS-155) — only that one per-row cell crosses the client boundary.

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { isOverdue } from "@/lib/tasks/is-overdue";
import type { TaskCardTask } from "@/components/task/task-card";
import type { ProjectListTaskSort } from "@/lib/queries/tasks";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DueDateSortHeader } from "@/components/task/due-date-sort-header";
import { ListStatusSelect } from "@/components/task/list-status-select";
// F106 (AS-135): priority label/color now comes from the single shared
// lib/task-colors.ts constant (same source as TaskCard's badge and the
// dashboard charts) instead of this component's own local
// PRIORITY_LABELS copy, which previously carried no color at all.
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  sort,
  hasActiveFilters = false,
  clearFiltersHref,
}: {
  tasks: TaskCardTask[];
  /** taskAssigneeId -> display name, resolved server-side (F053). */
  assigneeNames: Map<string, string>;
  /** F055 (AS-091): current due-date sort, drives the header's icon/state. */
  sort?: ProjectListTaskSort;
  /**
   * F056 (AS-092): whether any of F054's filters (status/priority/assignee)
   * are currently applied. Distinguishes "zero tasks because the project is
   * genuinely empty" from "zero tasks because the active filters exclude
   * everything" — the two need different copy so a user who filtered a
   * populated project into nothing isn't told the project has no tasks.
   */
  hasActiveFilters?: boolean;
  /**
   * F056: pathname with no filter query params, i.e. the same
   * "navigate to base pathname" action `<ListFilters>`'s own Clear
   * filters button performs (F054). Rendered as a plain server-rendered
   * link here (this component stays a Server Component) rather than
   * duplicating `<ListFilters>`'s client-side `router.push` logic.
   */
  clearFiltersHref?: string;
}) {
  if (tasks.length === 0) {
    if (hasActiveFilters) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No tasks match your filters.
          </p>
          {clearFiltersHref && (
            <Link
              href={clearFiltersHref}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Clear filters
            </Link>
          )}
        </div>
      );
    }
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
          <TableHead>
            <DueDateSortHeader sort={sort} />
          </TableHead>
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
                <ListStatusSelect taskId={task.id} status={task.status} />
              </TableCell>
              <TableCell>
                {task.priority ? (
                  <Badge
                    variant="secondary"
                    className="gap-1.5"
                    style={{ borderColor: PRIORITY_COLORS[task.priority] }}
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: PRIORITY_COLORS[task.priority] }}
                    />
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
