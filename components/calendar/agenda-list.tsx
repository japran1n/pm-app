// F235 (AS-449): the phone-width fallback for the month grid -- an agenda
// list grouped by day, not the grid shrunk with CSS. Per this feature's
// spec Notes ("the agenda fallback is a different component, not CSS
// trickery on the grid") and clarified "simpler option, no new
// dependency" answer, both this Server Component and `<MonthGrid>` render
// unconditionally in month-grid.tsx and Tailwind's own responsive display
// utilities (`hidden md:block` / `md:hidden`) pick exactly one per
// viewport -- the same `md:hidden` breakpoint (768px) this codebase
// already uses for its one other "phone gets a different layout, not a
// squeezed one" case (components/nav/app-sidebar.tsx's hamburger-menu
// Sheet). No client-side viewport detection/JS branch is needed for
// either surface to render correctly at first paint (a mid-render
// resize/rotation just swaps which of the two pre-rendered trees is
// visible via CSS, matching how the sidebar's own breakpoint already
// behaves).
//
// Equivalent affordances (this feature's own DoD: "the drag-reschedule
// and overflow popover ... must still be usable or have an equivalent
// affordance"):
//   - Overflow: N/A by construction -- an agenda list has no fixed-height
//     cell to overflow out of; every task due that day is simply another
//     row, so there is nothing to cap or hide behind a "+N more" control.
//   - Drag-reschedule: dragging a chip is a poor touch affordance to
//     begin with (no dnd-kit touch sensor is wired anywhere else in this
//     codebase either), so the equivalent chosen here is the SAME
//     click-through every chip already offers -- tapping a task opens the
//     board's `?taskId=` deep-linked detail sheet, where its existing
//     due-date field already calls the identical `editTask` Server Action
//     calendar-day-grid.tsx's drag handler does (lib/actions/tasks.ts).
//     One real mutation path, two different ways to reach it -- never a
//     second reschedule action built for this surface alone.

import Link from "next/link";

import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
import { UserAvatarGroup } from "@/components/user-avatar-group";
import { cn } from "@/lib/utils";

export function AgendaList({
  days,
  tasksByDate,
  workspaceSlug,
}: {
  days: CalendarDay[];
  tasksByDate: Record<string, CalendarTask[]>;
  workspaceSlug: string;
}) {
  const daysWithTasks = days.filter((day) => (tasksByDate[day.date] ?? []).length > 0);

  if (daysWithTasks.length === 0) {
    return (
      <p
        className="rounded-lg border border-dashed p-6 text-center text-mini text-muted-foreground"
        data-testid="calendar-agenda-empty"
      >
        No tasks are due this month.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="calendar-agenda-list">
      {daysWithTasks.map((day) => (
        <section key={day.date} data-testid={`calendar-agenda-day-${day.date}`}>
          <h2
            className={cn(
              "mb-1.5 text-micro font-semibold text-muted-foreground",
              day.isToday && "text-primary",
            )}
          >
            {formatAgendaDayLabel(day)}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {(tasksByDate[day.date] ?? []).map((task) => (
              <li key={task.id}>
                <AgendaTaskRow task={task} workspaceSlug={workspaceSlug} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function formatAgendaDayLabel(day: CalendarDay): string {
  // `day.date` is already the real "YYYY-MM-DD" for this cell (including
  // an adjacent month's own date for a leading/trailing day) -- anchored
  // at UTC purely to render the label, same "month/year identity, not a
  // day-level instant" rationale month-grid.tsx's own header uses.
  const [year, month, dayOfMonth] = day.date.split("-").map(Number);
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, dayOfMonth)));
  return day.isToday ? `${formatted} · Today` : formatted;
}

function AgendaTaskRow({
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
        "flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 text-mini hover:bg-muted/60",
        task.isDone && "opacity-60",
      )}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: PRIORITY_COLORS[priority] }}
        aria-hidden="true"
      />
      <span className="sr-only">{PRIORITY_LABELS[priority]}</span>
      {key && (
        <span className="shrink-0 font-mono text-micro text-muted-foreground">{key}</span>
      )}
      <span className={cn("min-w-0 flex-1 truncate", task.isDone && "line-through")}>
        {task.title}
      </span>
      <span className="shrink-0 truncate text-micro text-muted-foreground">
        {task.projectName}
      </span>
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
