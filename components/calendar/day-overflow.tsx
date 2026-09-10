"use client";

// F233 (AS-447): a day cell only shows the first DAY_CELL_VISIBLE_TASKS
// chips inline (day-cell.tsx) -- this is the "+N more" control that
// reveals the rest, in a popover rather than by growing the cell (which
// would break the month grid's fixed-height rows). Base UI's Popover
// (components/ui/popover.tsx, same primitive components/notifications/
// notification-bell.tsx already uses) renders its trigger as a real
// <button>, so this is keyboard-reachable (Tab to focus, Enter/Space to
// open, Escape to close) by construction -- no hover-only affordance, per
// this feature's clarification note ("must be keyboard reachable, not
// hover-only").
//
// Each listed task reuses the exact same board `?taskId=` deep-link
// (AS-444's real path -- see day-cell.tsx's TaskChip) rather than a
// second click-to-open implementation living only inside this popover.

import Link from "next/link";

import type { CalendarTask } from "@/lib/queries/calendar";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function DayOverflow({
  tasks,
  workspaceSlug,
}: {
  tasks: CalendarTask[];
  workspaceSlug: string;
}) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-left font-mono text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-label={`Show ${tasks.length} more task${tasks.length === 1 ? "" : "s"}`}
          >
            +{tasks.length} more
          </button>
        }
      />
      <PopoverContent align="start" className="w-64 p-1.5">
        <div className="flex flex-col gap-1">
          {tasks.map((task) => {
            const key = formatTaskKey(task.projectKey, task.number);
            const priority = (task.priority ?? "none") as keyof typeof PRIORITY_COLORS;
            return (
              <Link
                key={task.id}
                href={`/w/${workspaceSlug}/projects/${task.projectId}/board?taskId=${task.id}`}
                className={cn(
                  "flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-1 text-xs hover:bg-muted/60",
                  task.isDone && "opacity-60 line-through",
                )}
                title={task.title}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: PRIORITY_COLORS[priority] }}
                  aria-hidden
                />
                <span className="sr-only">{PRIORITY_LABELS[priority]}</span>
                {key && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {key}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
