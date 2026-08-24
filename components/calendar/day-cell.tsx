// F232 (AS-442, AS-450): one day cell in the month grid -- the day
// number plus the compact task chips due on it. Pure presentation, no
// hooks/state, so it stays a Server Component (composed by
// components/calendar/month-grid.tsx) per the clarified "Server Component
// for data loading, Client Component only for interaction" pattern --
// clicking a chip (AS-444) and dragging a chip (AS-445) are F233/F234's
// own client-boundary work, deliberately left as clean seams here (a
// plain `<Link>` for the click-through today; no drag handlers).

import Link from "next/link";

import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { PRIORITY_COLORS } from "@/lib/task-colors";
import { UserAvatarGroup } from "@/components/user-avatar-group";
import { cn } from "@/lib/utils";

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
        {tasks.map((task) => (
          <TaskChip key={task.id} task={task} workspaceSlug={workspaceSlug} />
        ))}
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
