import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, CalendarDays, BarChart3, DollarSign } from "lucide-react";

import type {
  MyTimeEntryInRange,
  PersonTimeByProject,
  PersonTimeDaily,
} from "@/lib/queries/time-entries";
import type { CalendarWeek } from "@/lib/calendar/week-grid";
import type { CalendarMonth } from "@/lib/calendar/month-grid";
import { formatDuration } from "@/lib/time/format-duration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WeeklyTimeGrid, type WeeklyGridTask } from "@/components/time/weekly-time-grid";
import { MyTimeBarChart, type TimeBarDatum } from "@/components/time/my-time-bar-chart";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WORKDAY_MINUTES = 8 * 60;
const WORKWEEK_MINUTES = 5 * WORKDAY_MINUTES;

function dayLabel(dateOnly: string, index: number): string {
  const day = Number.parseInt(dateOnly.split("-")[2] ?? "0", 10);
  return `${DAY_LABELS[index]} ${day}`;
}

function formatShortDate(dateOnly: string): string {
  const [, m, d] = dateOnly.split("-");
  return `${Number.parseInt(m ?? "0", 10)}/${Number.parseInt(d ?? "0", 10)}`;
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
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Today"
          minutes={summary.todayMinutes}
          capacity={WORKDAY_MINUTES}
          icon={<Clock className="size-4 text-muted-foreground" />}
          testId="summary-card-today"
        />
        <SummaryCard
          label="This week"
          minutes={summary.weekMinutes}
          capacity={WORKWEEK_MINUTES}
          icon={<CalendarDays className="size-4 text-muted-foreground" />}
          testId="summary-card-this-week"
        />
        <SummaryCard
          label="This month"
          minutes={summary.monthMinutes}
          icon={<BarChart3 className="size-4 text-muted-foreground" />}
          testId="summary-card-this-month"
        />
      </div>

      {/* View toggle */}
      <div
        role="tablist"
        aria-label="My time view"
        className="flex w-fit items-center gap-1 rounded-md border border-border bg-muted/30 p-1"
      >
        {(["daily", "weekly", "monthly"] as const).map((mode) => (
          <Link
            key={mode}
            href={viewLink(mode)}
            role="tab"
            aria-selected={view === mode}
            className={cn(
              "rounded px-3 py-1.5 text-sm capitalize transition-colors",
              view === mode
                ? "bg-background text-foreground shadow-xs font-medium"
                : "text-muted-foreground hover:text-foreground",
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

      {/* By project breakdown */}
      <Card aria-label="By project" data-testid="by-project-card">
        <CardHeader>
          <CardTitle className="text-sm">By project</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {byProject.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No time logged in this period.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border/60">
              {byProject.map((row) => {
                const billablePct = row.totalMinutes > 0
                  ? Math.round((row.billableMinutes / row.totalMinutes) * 100)
                  : 0;
                return (
                  <div
                    key={row.projectId}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <span className="min-w-0 truncate text-sm font-medium">{row.projectName}</span>
                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      {row.billableMinutes > 0 && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="size-3 text-status-done" />
                          <span className="font-mono tabular-nums text-status-done">{formatDuration(row.billableMinutes)}</span>
                        </span>
                      )}
                      <span className="font-mono tabular-nums font-medium text-foreground">
                        {formatDuration(row.totalMinutes)}
                      </span>
                      {billablePct > 0 && (
                        <span className="text-muted-foreground/70">{billablePct}%</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {view !== "daily" && (
        <Card aria-label="Time chart">
          <CardHeader>
            <CardTitle className="text-sm">{view === "weekly" ? "Hours by day" : "Hours by week"}</CardTitle>
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

function SummaryCard({
  label,
  minutes,
  capacity,
  icon,
  testId,
}: {
  label: string;
  minutes: number;
  capacity?: number;
  icon: React.ReactNode;
  testId: string;
}) {
  const pct = capacity ? Math.min(Math.round((minutes / capacity) * 100), 100) : null;
  const over = capacity ? minutes > capacity : false;

  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
          {icon}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-end justify-between gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums leading-none">
            {formatDuration(minutes)}
          </span>
          {pct !== null && (
            <span className={cn(
              "mb-0.5 font-mono text-xs tabular-nums",
              over ? "text-status-blocked" : "text-muted-foreground",
            )}>
              {pct}%
            </span>
          )}
        </div>
        {capacity && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border/60">
            <div
              className={cn("h-full rounded-full transition-all", over ? "bg-status-blocked" : "bg-primary")}
              style={{ width: `${Math.min((minutes / capacity) * 100, 100)}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NavButton({ href, direction }: { href: string; direction: "prev" | "next" }) {
  return (
    <Link
      href={href}
      className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      aria-label={direction === "prev" ? "Previous" : "Next"}
    >
      {direction === "prev" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </Link>
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
  const total = dayEntries.reduce((sum, e) => sum + e.minutes, 0);

  // Format date as "Mon, Sep 21"
  const dateObj = new Date(`${selectedDate}T12:00:00Z`);
  const dateLabel = dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <Card aria-label="Daily time entries">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <div className="flex items-center gap-3">
          <NavButton href={`${base}?view=daily&date=${prevDate}`} direction="prev" />
          <div>
            <CardTitle className="text-base font-semibold">{dateLabel}</CardTitle>
            {total > 0 && (
              <p className="font-mono text-xs text-muted-foreground tabular-nums">{formatDuration(total)} tracked</p>
            )}
          </div>
          <NavButton href={`${base}?view=daily&date=${nextDate}`} direction="next" />
        </div>
      </CardHeader>
      <CardContent className="px-0 pt-4">
        {dayEntries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No time logged on this day.</p>
        ) : (
          <div className="flex flex-col">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-border/60 px-4 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Task</span>
              <span className="w-16 text-right">Billable</span>
              <span className="w-20 text-right">Note</span>
              <span className="w-16 text-right">Duration</span>
            </div>
            {dayEntries.map((entry) => (
              <div
                key={entry.id}
                data-testid="daily-entry-row"
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0 hover:bg-muted/20"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entry.taskTitle}</p>
                  {entry.projectName && (
                    <p className="truncate text-xs text-muted-foreground">{entry.projectName}</p>
                  )}
                </div>
                <div className="w-16 text-right">
                  {entry.billable ? (
                    <Badge className="text-status-done">Bill.</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground/40">—</span>
                  )}
                </div>
                <div className="w-20 text-right">
                  {entry.note ? (
                    <span className="truncate text-xs text-muted-foreground" title={entry.note}>
                      {entry.note}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/40">—</span>
                  )}
                </div>
                <div className="w-16 text-right font-mono text-sm tabular-nums font-medium">
                  {formatDuration(entry.minutes)}
                </div>
              </div>
            ))}
            {/* Day total footer */}
            <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total</span>
              <span className="font-mono text-sm font-bold tabular-nums text-foreground">{formatDuration(total)}</span>
            </div>
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

  // Build "Sep 21 – Sep 27" label from weekKey ("2026-09-21")
  const firstDay = calendarWeek.days[0];
  const lastDay = calendarWeek.days[calendarWeek.days.length - 1];
  const rangeLabel = firstDay && lastDay
    ? `${formatShortDate(firstDay.date)} – ${formatShortDate(lastDay.date)}`
    : weekKey;

  return (
    <Card aria-label="Weekly time grid">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <div className="flex items-center gap-3">
          <NavButton href={`${base}?view=weekly&week=${prevWeekKey}`} direction="prev" />
          <div>
            <CardTitle className="text-base font-semibold">
              <span className="font-mono">{rangeLabel}</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground">Week of <span className="font-mono">{weekKey}</span></p>
          </div>
          <NavButton href={`${base}?view=weekly&week=${nextWeekKey}`} direction="next" />
        </div>
      </CardHeader>
      <CardContent className="px-0 pt-4" key={weekKey}>
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

  const monthLabel = new Date(`${calendarMonth.monthKey}-01T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const weeks: (typeof calendarMonth.days)[] = [];
  for (let i = 0; i < calendarMonth.days.length; i += 7) {
    weeks.push(calendarMonth.days.slice(i, i + 7));
  }

  const maxDayMinutes = Math.max(...dailyForRange.map((d) => d.totalMinutes), 1);

  return (
    <Card aria-label="Monthly calendar">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <div className="flex items-center gap-3">
          <NavButton href={`${base}?view=monthly&month=${prevMonthKey}`} direction="prev" />
          <div>
            <CardTitle className="text-base font-semibold">{monthLabel}</CardTitle>
            {total > 0 && (
              <p className="font-mono text-xs text-muted-foreground tabular-nums">{formatDuration(total)} total</p>
            )}
          </div>
          <NavButton href={`${base}?view=monthly&month=${nextMonthKey}`} direction="next" />
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-7 gap-1 text-center">
          {DAY_LABELS.map((label) => (
            <span key={label} className="py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
          ))}
        </div>
        <div className="mt-1 flex flex-col gap-1" data-testid="monthly-calendar-grid">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7 gap-1">
              {week.map((day) => {
                const minutes = minutesByDate.get(day.date) ?? 0;
                const fillPct = minutes > 0 ? Math.min((minutes / maxDayMinutes) * 100, 100) : 0;
                return (
                  <Link
                    key={day.date}
                    href={`${base}?view=daily&date=${day.date}`}
                    data-testid="monthly-calendar-day"
                    className={cn(
                      "group relative flex h-16 flex-col items-center justify-center overflow-hidden rounded-md border transition-colors hover:border-border",
                      !day.isCurrentMonth && "opacity-40",
                      day.isToday ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/30",
                    )}
                  >
                    {fillPct > 0 && (
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-primary/10 transition-all"
                        style={{ height: `${fillPct}%` }}
                        aria-hidden="true"
                      />
                    )}
                    <span className={cn("relative z-10 font-mono text-xs", day.isToday && "font-semibold text-primary")}>
                      {Number.parseInt(day.date.split("-")[2] ?? "0", 10)}
                    </span>
                    {minutes > 0 && (
                      <span className="relative z-10 font-mono text-xs font-medium tabular-nums text-foreground">
                        {formatDuration(minutes)}
                      </span>
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
