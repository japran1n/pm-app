// F232 (AS-442, AS-450) + F233 (AS-444, AS-447): one day cell in the month
// grid -- the day number, the compact task chips due on it (each a real
// click-through to the board's `?taskId=` deep link -- see TaskChip below,
// the exact same route/param board.tsx's own click-to-open effect already
// listens on, so AS-444 is proven against the real getTaskDetail path, not
// a second sheet built here), and, once a cell has more tasks than fit, an
// overflow control (day-overflow.tsx) revealing the rest. Pure
// presentation, no hooks/state of its own, so it stays a Server Component
// (composed by components/calendar/month-grid.tsx) per the clarified
// "Server Component for data loading, Client Component only for
// interaction" pattern -- DayOverflow is the one small "use client"
// island this file renders, kept as small as possible (F234's
// drag-reschedule remains a clean seam around the day-cell mapping in
// month-grid.tsx, unaffected by this).
//
// AS-447's cap: a day cell shows at most DAY_CELL_VISIBLE_TASKS chips
// inline; anything beyond that renders behind the "+N more" popover
// instead of growing the cell's height (which would break the month
// grid's fixed-row layout other days rely on).

import Link from "next/link";

import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { PRIORITY_COLORS } from "@/lib/task-colors";
import { UserAvatarGroup } from "@/components/user-avatar-group";
import { DayOverflow } from "@/components/calendar/day-overflow";
import { cn } from "@/lib/utils";

const DAY_CELL_VISIBLE_TASKS = 3;

export function DayCell({
  day,
  tasks,
  workspaceSlug,
}: {
  day: CalendarDay;
  tasks: CalendarTask[];
  workspaceSlug: string;
}) {
  const dayNumber = Number(day.date.slice(-2));
  const visibleTasks = tasks.slice(0, DAY_CELL_VISIBLE_TASKS);
  const overflowTasks = tasks.slice(DAY_CELL_VISIBLE_TASKS);

  return (
    <div
      data-date={day.date}
      className={cn(
        "flex min-h-[7rem] flex-col gap-1 border-b border-r border-border/60 p-1.5 text-xs",
        !day.isCurrentMonth && "bg-muted/30 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium",
          day.isToday && "bg-primary text-primary-foreground",
        )}
      >
        {dayNumber}
      </span>
      <div className="flex flex-col gap-1 overflow-hidden">
        {visibleTasks.map((task) => (
          <TaskChip key={task.id} task={task} workspaceSlug={workspaceSlug} />
        ))}
        <DayOverflow tasks={overflowTasks} workspaceSlug={workspaceSlug} />
      </div>
    </div>
  );
}

function TaskChip({
  task,
  workspaceSlug,
}: {
  task: CalendarTask;
  workspaceSlug: string;
}) {
  const key = formatTaskKey(task.projectKey, task.number);
  const priority = (task.priority ?? "none") as keyof typeof PRIORITY_COLORS;

  return (
    <Link
      href={`/w/${workspaceSlug}/projects/${task.projectId}/board?taskId=${task.id}`}
      className={cn(
        "flex min-w-0 items-center gap-1 truncate rounded border border-border/60 bg-card px-1.5 py-0.5 hover:bg-muted/60",
        task.isDone && "opacity-60 line-through",
      )}
      title={task.title}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: PRIORITY_COLORS[priority] }}
        aria-hidden
      />
      {key && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {key}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      {task.assignees.length > 0 && (
        <UserAvatarGroup
          people={task.assignees.map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            avatarUrl: a.avatarUrl,
          }))}
          size="sm"
          max={1}
        />
      )}
    </Link>
  );
}
