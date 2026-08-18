// F053 (AS-085): the project List view — all non-deleted tasks in a
// project rendered as a shadcn Table with title, status, priority,
// assignee, and due date columns.
//
// BUGFIX (TaskDetailSheet was fully built but never rendered anywhere):
// this component crossed the Client Component boundary (was previously a
// plain Server Component, per this comment's now-outdated original text)
// so a row click can open <TaskDetailSheet>, mirroring the Board view's
// own TaskCard-click wiring (components/board/board.tsx). AS-155's
// "primary content server-rendered in initial HTML" requirement still
// holds in practice: the table's own rows are still rendered from the
// `tasks` prop the Server Component page (list/page.tsx) fetched and
// passed down — only the *interactivity* (row click, the sheet itself)
// needs the client boundary, same rationale TaskCard/BoardColumn already
// establish for the board.
//
// Status/priority are shown as Badge (color) + text label together, never
// color alone, matching AS-153's rule (already followed by BoardColumn's
// COLUMN_LABELS and TaskCard's PRIORITY_LABELS) even though AS-153 itself
// isn't this feature's assigned assertion — no reason to regress it here.
//
// F057 (AS-093): the Status cell renders <ListStatusSelect>, a small
// Client Component wrapping a shadcn Select. Its cell stops click
// propagation (see the Status <TableCell> below) so interacting with the
// status dropdown doesn't also open the detail sheet underneath it.

"use client";

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
import { useTaskDetailSheet } from "@/components/task/use-task-detail-sheet";
import {
  TaskDetailSheet,
  type TaskDetailSheetMember,
} from "@/components/task/task-detail-sheet";
// F122 (AS-214): the Assignee column (shared by the project List view and
// the workspace dashboard table — components/dashboard/
// dashboard-task-table.tsx composes this same component) now renders the
// shared avatar component instead of plain text.
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";

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
  assignees,
  sort,
  hasActiveFilters = false,
  clearFiltersHref,
  members = [],
  timezone = "UTC",
}: {
  tasks: TaskCardTask[];
  /** F122 (AS-214): taskAssigneeId -> resolved person (name/email/
   * avatarUrl), resolved server-side. Renamed from F053's original
   * `assigneeNames: Map<string, string>` now that the Assignee column
   * renders an avatar, not just text — every caller (project List page,
   * the dashboard table) was updated alongside this component. */
  assignees: Map<string, UserAvatarPerson>;
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
  /**
   * BUGFIX: workspace members offered as assignee choices inside the
   * detail sheet opened by a row click (TaskDetailSheet's own assignee
   * Select) — same TaskDetailSheetMember shape/rationale as Board's own
   * `members` prop (components/board/board.tsx).
   */
  members?: TaskDetailSheetMember[];
  /** F124 (AS-207): the viewer's IANA timezone, resolved once per request
   * by the Server Component page (project list/page.tsx, or the dashboard
   * page via dashboard-task-table.tsx) via lib/queries/profile.ts's
   * getCurrentUserTimezone, and passed straight through here — never
   * fetched by this Client Component, never per row. Defaults to "UTC" so
   * existing/test callers that don't pass one still render. */
  timezone?: string;
}) {
  const taskDetailSheet = useTaskDetailSheet();

  function handleTaskDeleted(deletedTaskId: string) {
    // No local task-list state here (this component receives `tasks` as a
    // prop from the Server Component page, which re-fetches via
    // revalidatePath after a mutating Server Action) — a deleted row
    // disappears once that revalidation lands. In the meantime the sheet
    // itself has already closed (TaskDetailSheet's own handleDelete calls
    // onOpenChange(false) before onDeleted), so there's nothing else to
    // reconcile client-side here.
    void deletedTaskId;
  }

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
    <>
    <div className="rounded-lg border border-border/60 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
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
            const overdue = isOverdue(task.dueDate, task.status, timezone);
            const assignee = task.assigneeId
              ? assignees.get(task.assigneeId)
              : null;

            return (
              <TableRow
                key={task.id}
                data-task-id={task.id}
                role="button"
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => taskDetailSheet.openTask(task.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    taskDetailSheet.openTask(task.id);
                  }
                }}
              >
                <TableCell className="font-medium">{task.title}</TableCell>
                {/* stopPropagation: interacting with the status dropdown
                    should change the status, not also open the detail
                    sheet underneath it. */}
                <TableCell onClick={(event) => event.stopPropagation()}>
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
                        style={{
                          backgroundColor: PRIORITY_COLORS[task.priority],
                        }}
                      />
                      {PRIORITY_LABELS[task.priority]}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {assignee ? (
                    <span className="flex items-center gap-2">
                      <UserAvatar person={assignee} size="sm" />
                      {assignee.name || assignee.email || assignee.id}
                    </span>
                  ) : (
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
    </div>

    <TaskDetailSheet
      task={taskDetailSheet.task}
      members={members}
      comments={taskDetailSheet.comments}
      attachments={taskDetailSheet.attachments}
      open={taskDetailSheet.open}
      onOpenChange={taskDetailSheet.onOpenChange}
      loading={taskDetailSheet.loading}
      error={taskDetailSheet.error}
      onRetry={taskDetailSheet.retry}
      onDeleted={handleTaskDeleted}
      currentUserId={taskDetailSheet.currentUserId}
      currentUserRole={taskDetailSheet.currentUserRole}
      timezone={timezone}
    />
    </>
  );
}
