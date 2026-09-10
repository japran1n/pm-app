// Server-rendered body of the "My time" personal dashboard
// (app/(workspace)/w/[workspaceSlug]/time/me/page.tsx): summary cards, the
// daily/weekly/monthly toggle (plain <Link>s writing `?view=`, mirroring
// /time/page.tsx's own GET-form-for-navigation convention -- no client JS
// needed for the toggle itself), the selected view's content, the
// by-project breakdown, and the bar chart. Only the weekly grid's cells
// need interactivity, which is isolated in the client component
// <WeeklyTimeGrid> (components/time/weekly-time-grid.tsx).
import Link from "next/link";

import type {
  MyTimeEntryInRange,
  PersonTimeByProject,
  PersonTimeDaily,
} from "@/lib/queries/time-entries";
import type { CalendarWeek } from "@/lib/calendar/week-grid";
import type { CalendarMonth } from "@/lib/calendar/month-grid";
import { formatDuration } from "@/lib/time/format-duration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { WeeklyTimeGrid, type WeeklyGridTask } from "@/components/time/weekly-time-grid";
import { MyTimeBarChart, type TimeBarDatum } from "@/components/time/my-time-bar-chart";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayLabel(dateOnly: string, index: number): string {
  const day = Number.parseInt(dateOnly.split("-")[2] ?? "0", 10);
  return `${DAY_LABELS[index]} ${day}`;
}

type ViewMode = "daily" | "weekly" | "monthly";

export function MyTimeView({
  workspaceSlug,
  view,
  summary,
  entries,
  byProject,
  dailyForRange,
  assignedTasks,
  selectedDate,
  calendarWeek,
  calendarMonth,
  weekKey,
  prevWeekKey,
  nextWeekKeyValue,
  prevMonthKeyParts,
  nextMonthKeyParts,
  prevDate,
  nextDate,
}: {
  workspaceSlug: string;
  view: ViewMode;
  summary: { todayMinutes: number; weekMinutes: number; monthMinutes: number };
  entries: MyTimeEntryInRange[];
  byProject: PersonTimeByProject[];
  dailyForRange: PersonTimeDaily[];
  assignedTasks: { id: string; title: string; projectName: string }[];
  selectedDate: string;
  calendarWeek: CalendarWeek;
  calendarMonth: CalendarMonth;
  weekKey: string;
  prevWeekKey: string;
  nextWeekKeyValue: string;
  prevMonthKeyParts: { year: number; month: number };
  nextMonthKeyParts: { year: number; month: number };
  prevDate: string;
  nextDate: string;
}) {
  const base = `/w/${workspaceSlug}/time/me`;

  function viewLink(mode: ViewMode): string {
    return `${base}?view=${mode}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Today" minutes={summary.todayMinutes} />
        <SummaryCard label="This week" minutes={summary.weekMinutes} />
        <SummaryCard label="This month" minutes={summary.monthMinutes} />
      </div>

      <div
        role="tablist"
        aria-label="My time view"
        className="flex w-fit items-center gap-1 rounded-md border p-1"
      >
        {(["daily", "weekly", "monthly"] as const).map((mode) => (
          <Link
            key={mode}
            href={viewLink(mode)}
            role="tab"
            aria-selected={view === mode}
            className={cn(
              "rounded px-3 py-1 text-sm capitalize",
              view === mode
                ? "bg-secondary font-medium"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {mode}
          </Link>
        ))}
      </div>

      {view === "daily" && (
        <DailyView
          base={base}
          selectedDate={selectedDate}
          prevDate={prevDate}
          nextDate={nextDate}
          entries={entries}
        />
      )}

      {view === "weekly" && (
        <WeeklyView
          base={base}
          calendarWeek={calendarWeek}
          weekKey={weekKey}
          prevWeekKey={prevWeekKey}
          nextWeekKey={nextWeekKeyValue}
          entries={entries}
          assignedTasks={assignedTasks}
        />
      )}

      {view === "monthly" && (
        <MonthlyView
          base={base}
          calendarMonth={calendarMonth}
          prevMonthKeyParts={prevMonthKeyParts}
          nextMonthKeyParts={nextMonthKeyParts}
          dailyForRange={dailyForRange}
        />
      )}

      <Card aria-label="By project" data-testid="by-project-card">
        <CardHeader>
          <CardTitle>By project</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {byProject.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No time logged in this period.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border/60 border-t border-border/60">
              {byProject.map((row) => (
                <div
                  key={row.projectId}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <span className="text-sm font-medium">{row.projectName}</span>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
                    <span className="font-mono">{formatDuration(row.totalMinutes)} total</span>
                    <span className="font-mono">· {formatDuration(row.billableMinutes)} billable</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {view !== "daily" && (
        <Card aria-label="Time chart">
          <CardHeader>
            <CardTitle>{view === "weekly" ? "Hours by day" : "Hours by week"}</CardTitle>
          </CardHeader>
          <CardContent>
            <MyTimeBarChart
              data={
                view === "weekly"
                  ? buildWeeklyChartData(calendarWeek, dailyForRange)
                  : buildMonthlyChartData(calendarMonth, dailyForRange)
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ label, minutes }: { label: string; minutes: number }) {
  return (
    <Card data-testid={`summary-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <span className="font-mono text-2xl font-semibold tabular-nums">{formatDuration(minutes)}</span>
      </CardContent>
    </Card>
  );
}

function DailyView({
  base,
  selectedDate,
  prevDate,
  nextDate,
  entries,
}: {
  base: string;
  selectedDate: string;
  prevDate: string;
  nextDate: string;
  entries: MyTimeEntryInRange[];
}) {
  const dayEntries = entries.filter((e) => e.entryDate === selectedDate);

  const byTask = new Map<string, { title: string; projectName: string | null; minutes: number }>();
  for (const entry of dayEntries) {
    const bucket = byTask.get(entry.taskId) ?? {
      title: entry.taskTitle,
      projectName: entry.projectName,
      minutes: 0,
    };
    bucket.minutes += entry.minutes;
    byTask.set(entry.taskId, bucket);
  }

  const total = dayEntries.reduce((sum, e) => sum + e.minutes, 0);

  return (
    <Card aria-label="Daily time entries">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          <span className="font-mono">{selectedDate} · {formatDuration(total)}</span>
        </CardTitle>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`${base}?view=daily&date=${prevDate}`} className="rounded border px-2 py-1 hover:bg-secondary">
            ← Previous day
          </Link>
          <Link href={`${base}?view=daily&date=${nextDate}`} className="rounded border px-2 py-1 hover:bg-secondary">
            Next day →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {byTask.size === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">No time logged on this day.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border/60 border-t border-border/60">
            {Array.from(byTask.entries()).map(([taskId, bucket]) => (
              <div
                key={taskId}
                data-testid="daily-entry-row"
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{bucket.title}</span>
                  {bucket.projectName && (
                    <span className="text-xs text-muted-foreground">{bucket.projectName}</span>
                  )}
                </div>
                <span className="font-mono text-sm tabular-nums text-muted-foreground">
                  {formatDuration(bucket.minutes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WeeklyView({
  base,
  calendarWeek,
  weekKey,
  prevWeekKey,
  nextWeekKey,
  entries,
  assignedTasks,
}: {
  base: string;
  calendarWeek: CalendarWeek;
  weekKey: string;
  prevWeekKey: string;
  nextWeekKey: string;
  entries: MyTimeEntryInRange[];
  assignedTasks: { id: string; title: string; projectName: string }[];
}) {
  const days = calendarWeek.days.map((day, i) => ({
    date: day.date,
    label: dayLabel(day.date, i),
    isToday: day.isToday,
  }));

  const taskMap = new Map<string, WeeklyGridTask>();
  for (const task of assignedTasks) {
    taskMap.set(task.id, { id: task.id, title: task.title, projectName: task.projectName });
  }
  for (const entry of entries) {
    if (!taskMap.has(entry.taskId)) {
      taskMap.set(entry.taskId, {
        id: entry.taskId,
        title: entry.taskTitle,
        projectName: entry.projectName,
      });
    }
  }

  const cellMinutes: Record<string, number> = {};
  for (const entry of entries) {
    const key = `${entry.taskId}::${entry.entryDate}`;
    cellMinutes[key] = (cellMinutes[key] ?? 0) + entry.minutes;
  }

  return (
    <Card aria-label="Weekly time grid">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Week of <span className="font-mono">{calendarWeek.weekKey}</span></CardTitle>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`${base}?view=weekly&week=${prevWeekKey}`}
            className="rounded border px-2 py-1 hover:bg-secondary"
          >
            ← Previous week
          </Link>
          <Link
            href={`${base}?view=weekly&week=${nextWeekKey}`}
            className="rounded border px-2 py-1 hover:bg-secondary"
          >
            Next week →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="px-0" key={weekKey}>
        <WeeklyTimeGrid tasks={Array.from(taskMap.values())} days={days} cellMinutes={cellMinutes} />
      </CardContent>
    </Card>
  );
}

function MonthlyView({
  base,
  calendarMonth,
  prevMonthKeyParts,
  nextMonthKeyParts,
  dailyForRange,
}: {
  base: string;
  calendarMonth: CalendarMonth;
  prevMonthKeyParts: { year: number; month: number };
  nextMonthKeyParts: { year: number; month: number };
  dailyForRange: PersonTimeDaily[];
}) {
  const minutesByDate = new Map(dailyForRange.map((d) => [d.entryDate, d.totalMinutes]));
  const total = dailyForRange.reduce((sum, d) => sum + d.totalMinutes, 0);

  const prevMonthKey = `${prevMonthKeyParts.year}-${String(prevMonthKeyParts.month).padStart(2, "0")}`;
  const nextMonthKey = `${nextMonthKeyParts.year}-${String(nextMonthKeyParts.month).padStart(2, "0")}`;

  const weeks: (typeof calendarMonth.days)[] = [];
  for (let i = 0; i < calendarMonth.days.length; i += 7) {
    weeks.push(calendarMonth.days.slice(i, i + 7));
  }

  return (
    <Card aria-label="Monthly calendar">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          <span className="font-mono">{calendarMonth.monthKey} · {formatDuration(total)}</span>
        </CardTitle>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`${base}?view=monthly&month=${prevMonthKey}`}
            className="rounded border px-2 py-1 hover:bg-secondary"
          >
            ← Previous month
          </Link>
          <Link
            href={`${base}?view=monthly&month=${nextMonthKey}`}
            className="rounded border px-2 py-1 hover:bg-secondary"
          >
            Next month →
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
          {DAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="mt-1 flex flex-col gap-1" data-testid="monthly-calendar-grid">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7 gap-1">
              {week.map((day) => {
                const minutes = minutesByDate.get(day.date) ?? 0;
                return (
                  <Link
                    key={day.date}
                    href={`${base}?view=daily&date=${day.date}`}
                    data-testid="monthly-calendar-day"
                    className={cn(
                      "flex h-16 flex-col items-center justify-center rounded border text-xs hover:bg-secondary",
                      !day.isCurrentMonth && "opacity-40",
                      day.isToday && "border-primary",
                    )}
                  >
                    <span className="font-mono">{Number.parseInt(day.date.split("-")[2] ?? "0", 10)}</span>
                    {minutes > 0 && (
                      <span className="font-mono font-medium tabular-nums">{formatDuration(minutes)}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function buildWeeklyChartData(calendarWeek: CalendarWeek, dailyForRange: PersonTimeDaily[]): TimeBarDatum[] {
  const minutesByDate = new Map(dailyForRange.map((d) => [d.entryDate, d.totalMinutes]));
  return calendarWeek.days.map((day, i) => ({
    key: day.date,
    label: dayLabel(day.date, i),
    minutes: minutesByDate.get(day.date) ?? 0,
  }));
}

function buildMonthlyChartData(
  calendarMonth: CalendarMonth,
  dailyForRange: PersonTimeDaily[],
): TimeBarDatum[] {
  const minutesByDate = new Map(dailyForRange.map((d) => [d.entryDate, d.totalMinutes]));
  const weeks: number[] = [];
  const buckets: number[] = [];
  for (let i = 0; i < calendarMonth.days.length; i += 7) {
    const weekDays = calendarMonth.days.slice(i, i + 7);
    const total = weekDays.reduce((sum, day) => sum + (minutesByDate.get(day.date) ?? 0), 0);
    weeks.push(weeks.length + 1);
    buckets.push(total);
  }
  return weeks.map((weekNum, i) => ({
    key: `week-${weekNum}`,
    label: `Wk ${weekNum}`,
    minutes: buckets[i] ?? 0,
  }));
}
