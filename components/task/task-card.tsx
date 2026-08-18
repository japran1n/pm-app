// F040: reusable TaskCard — one task rendered as a compact card, meant to
// be shared by F042's board columns and possibly F053's list view (see
// tech-decisions.md file layout: components/board/ + components/task/).
// Pure presentational Client Component (no data fetching, no Server
// Actions) so both a board and a list can wrap it however they need
// (draggable wrapper for the board, plain row for the list).
//
// Overdue treatment (AS-064): isOverdue() from lib/tasks/is-overdue.ts is
// the single source of truth for "is this task overdue" so the board,
// list, and detail sheet never disagree. Per this feature's own note
// referencing AS-153 (a later accessibility requirement that a status
// can't be conveyed by color alone), the overdue due-date text is paired
// with a small TriangleAlert icon from lucide-react rather than red color
// alone — cheap to add now, and correct from the start rather than a
// retrofit later.

import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { isOverdue } from "@/lib/tasks/is-overdue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type TaskCardTask = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  assigneeId: string | null;
  dueDate: string | null;
  // F046 (AS-070, AS-078): the task's fractional-index board position.
  // Carried through the client-side board state so onDragEnd can compute
  // a dropped card's new neighbors' positions without a round-trip.
  position: number;
  // F103 (AS-076): the row's `updated_at` timestamp (ISO string), used by
  // reconcileTask as an ordering guard against out-of-order Realtime
  // events for the same task. Optional because the initial board fetch
  // doesn't strictly need to carry it (the very first Realtime event for
  // any given task always applies), but it's populated end-to-end so the
  // guard is live from the first Realtime update onward.
  updatedAt?: string;
};

const PRIORITY_LABELS: Record<
  NonNullable<TaskCardTask["priority"]>,
  string
> = {
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
  }).format(date);
}

export function TaskCard({
  task,
  onClick,
  className,
}: {
  task: TaskCardTask;
  /** Opens the task (e.g. TaskDetailSheet) when the card is activated. */
  onClick?: (taskId: string) => void;
  className?: string;
}) {
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <Card
      size="sm"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? () => onClick(task.id) : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick(task.id);
              }
            }
          : undefined
      }
      className={cn(
        onClick && "cursor-pointer hover:ring-foreground/20",
        className,
      )}
    >
      <CardHeader>
        <CardTitle className="line-clamp-2">{task.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {task.priority && (
          <Badge variant="secondary">{PRIORITY_LABELS[task.priority]}</Badge>
        )}
        {task.dueDate && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {overdue && (
              <TriangleAlert
                className="size-3"
                aria-hidden="true"
              />
            )}
            <span className={overdue ? "sr-only" : "hidden"}>Overdue:</span>
            {formatDueDate(task.dueDate)}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
