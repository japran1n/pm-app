// Phone-width week agenda: replaces the old static "use a wider screen"
// paragraph week-view.tsx used to render under `md:` -- tasks were
// unreachable on mobile (a real dead end; see
// tests/e2e/f235-calendar-responsive.spec.ts). Same posture as the month
// grid's retired agenda fallback (agenda-list.tsx): a different component
// for phones, not CSS trickery on the time grid, swapped purely by
// Tailwind's `md:hidden` / `hidden md:block` pair so no client-side
// viewport JS is needed. The container keeps the historical
// `calendar-week-mobile-fallback` testid so the e2e spec stays anchored.
//
// Tasks reach the exact same route the desktop grid's chips use
// (`/projects/<id>/board?taskId=<id>` -- week-time-grid.tsx); blocks are
// listed read-only with their time range (editing a block stays a
// desktop affordance).

import Link from "next/link";

import type { CalendarWeekDay } from "@/lib/calendar/week-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import { formatBlockTimeRange } from "@/lib/calendar/block-datetime";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
import { UserAvatarGroup } from "@/components/user-avatar-group";
import { cn } from "@/lib/utils";

export function WeekAgenda({
  days,
  tasksByDate,
  blocksByDate,
  workspaceSlug,
}: {
  days: CalendarWeekDay[];
  tasksByDate: Record<string, CalendarTask[]>;
  blocksByDate: Record<string, CalendarBlock[]>;
  workspaceSlug: string;
}) {
  const daysWithItems = days.filter(
    (day) =>
      (tasksByDate[day.date] ?? []).length > 0 || (blocksByDate[day.date] ?? []).length > 0,
  );

  return (
    <div
      className="flex flex-col gap-4 md:hidden"
      data-testid="calendar-week-mobile-fallback"
    >
      {daysWithItems.length === 0 ? (
        <p
          className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          data-testid="calendar-week-agenda-empty"
        >
          Nothing scheduled this week.
        </p>
      ) : (
        daysWithItems.map((day) => (
          <section key={day.date} data-testid={`calendar-week-agenda-day-${day.date}`}>
            <h2
              className={cn(
                "mb-1.5 font-mono text-xs font-semibold text-muted-foreground",
                day.isToday && "text-primary",
              )}
            >
              {formatAgendaDayLabel(day)}
            </h2>
            <ul className="flex flex-col gap-1.5">
              {(blocksByDate[day.date] ?? []).map((block) => (
                <li key={block.id}>
                  <AgendaBlockRow block={block} />
                </li>
              ))}
              {(tasksByDate[day.date] ?? []).map((task) => (
                <li key={task.id}>
                  <AgendaTaskRow task={task} workspaceSlug={workspaceSlug} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function formatAgendaDayLabel(day: CalendarWeekDay): string {
  // UTC-anchored purely to render the label from the DateOnly, same
  // rationale as week-view.tsx's own header helpers.
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
        "flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 text-sm hover:bg-muted/50",
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
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{key}</span>
      )}
      <span className={cn("min-w-0 flex-1 truncate", task.isDone && "line-through")}>
        {task.title}
      </span>
      <span className="shrink-0 truncate text-xs text-muted-foreground">
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

function AgendaBlockRow({ block }: { block: CalendarBlock }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 text-sm">
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {formatBlockTimeRange(block.startsAt, block.endsAt)}
      </span>
      <span className="min-w-0 flex-1 truncate">{block.title}</span>
    </div>
  );
}
