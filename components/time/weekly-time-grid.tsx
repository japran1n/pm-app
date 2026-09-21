"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { logTimeEntry } from "@/lib/actions/time-entries";
import { formatDuration } from "@/lib/time/format-duration";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type WeeklyGridTask = {
  id: string;
  title: string;
  projectName: string | null;
};

export type WeeklyGridDay = {
  date: string; // "YYYY-MM-DD"
  label: string; // "Mon 9"
  isToday: boolean;
};

const WORKDAY_MINUTES = 8 * 60;

function parseHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes(":")) {
    const [h, m] = trimmed.split(":");
    const hours = Number.parseInt(h ?? "", 10);
    const minutes = Number.parseInt(m ?? "", 10);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
  }
  const hours = Number.parseFloat(trimmed);
  if (Number.isNaN(hours) || hours <= 0) return null;
  return Math.round(hours * 60);
}

function DayTotalBar({ minutes }: { minutes: number }) {
  if (minutes === 0) return null;
  const pct = Math.min((minutes / WORKDAY_MINUTES) * 100, 100);
  const over = minutes > WORKDAY_MINUTES;
  return (
    <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-border/60">
      <div
        className={cn("h-full rounded-full transition-all", over ? "bg-status-blocked" : "bg-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function GridCell({
  taskId,
  date,
  minutes,
  isToday,
  onLogged,
}: {
  taskId: string;
  date: string;
  minutes: number;
  isToday: boolean;
  onLogged: (taskId: string, date: string, addedMinutes: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        data-testid="weekly-grid-cell"
        onClick={() => {
          setValue("");
          setEditing(true);
        }}
        className={cn(
          "flex h-9 w-full items-center justify-center rounded font-mono text-sm tabular-nums transition-colors",
          minutes > 0
            ? "font-medium text-foreground hover:bg-muted/50"
            : "text-border hover:bg-muted/50 hover:text-muted-foreground",
          isToday && minutes === 0 && "text-primary/30",
        )}
        aria-label={`Log time for ${date}`}
      >
        {minutes > 0 ? formatDuration(minutes) : "—"}
      </button>
    );
  }

  return (
    <form
      className="flex h-9 items-center justify-center"
      onSubmit={(e) => {
        e.preventDefault();
        const addedMinutes = parseHoursInput(value);
        if (addedMinutes === null) {
          setEditing(false);
          return;
        }
        startSaveTransition(async () => {
          const result = await logTimeEntry(taskId, addedMinutes, true, date);
          if (!result.ok) {
            toast.error(result.error);
            setEditing(false);
            return;
          }
          onLogged(taskId, date, addedMinutes);
          setEditing(false);
        });
      }}
    >
      <Input
        autoFocus
        disabled={isSaving}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        placeholder="1.5"
        className="h-8 w-16 text-center font-mono text-sm"
        aria-label={`Hours for ${date}`}
      />
    </form>
  );
}

export function WeeklyTimeGrid({
  tasks,
  days,
  cellMinutes,
}: {
  tasks: WeeklyGridTask[];
  days: WeeklyGridDay[];
  /** minutes keyed by `${taskId}::${date}` */
  cellMinutes: Record<string, number>;
}) {
  const [localMinutes, setLocalMinutes] = useState(cellMinutes);

  function handleLogged(taskId: string, date: string, addedMinutes: number) {
    const key = `${taskId}::${date}`;
    setLocalMinutes((current) => ({
      ...current,
      [key]: (current[key] ?? 0) + addedMinutes,
    }));
  }

  const rowTotals = tasks.map((task) =>
    days.reduce((sum, day) => sum + (localMinutes[`${task.id}::${day.date}`] ?? 0), 0),
  );
  const columnTotals = days.map((day) =>
    tasks.reduce((sum, task) => sum + (localMinutes[`${task.id}::${day.date}`] ?? 0), 0),
  );
  const grandTotal = columnTotals.reduce((sum, m) => sum + m, 0);

  if (tasks.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No tasks to log time against this week yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="weekly-time-grid">
        <thead>
          <tr>
            <th className="w-64 border-b border-border/60 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Task / Project
            </th>
            {days.map((day, i) => (
              <th
                key={day.date}
                className={cn(
                  "border-b border-border/60 px-2 py-2 text-center",
                  day.isToday && "bg-primary/5",
                )}
              >
                <div className={cn("text-xs font-medium", day.isToday ? "text-primary" : "text-muted-foreground")}>
                  <span className="font-mono">{day.label}</span>
                </div>
                <div className={cn("font-mono text-xs tabular-nums", columnTotals[i] ? "text-foreground font-semibold" : "text-muted-foreground/40")}>
                  {columnTotals[i] ? formatDuration(columnTotals[i]!) : "0h"}
                </div>
                <DayTotalBar minutes={columnTotals[i] ?? 0} />
              </th>
            ))}
            <th className="border-b border-border/60 px-3 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task, rowIndex) => (
            <tr key={task.id} className="group border-b border-border/40 last:border-b-0 hover:bg-muted/20">
              <td className="max-w-64 px-4 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="truncate text-sm font-medium leading-tight">{task.title}</span>
                  {task.projectName && (
                    <span className="truncate text-xs text-muted-foreground">
                      {task.projectName}
                    </span>
                  )}
                </div>
              </td>
              {days.map((day) => (
                <td
                  key={day.date}
                  className={cn("p-1 text-center", day.isToday && "bg-primary/5")}
                >
                  <GridCell
                    taskId={task.id}
                    date={day.date}
                    minutes={localMinutes[`${task.id}::${day.date}`] ?? 0}
                    isToday={day.isToday}
                    onLogged={handleLogged}
                  />
                </td>
              ))}
              <td className={cn(
                "px-3 py-2 text-center font-mono text-sm tabular-nums",
                (rowTotals[rowIndex] ?? 0) > 0 ? "font-semibold text-foreground" : "text-muted-foreground/40",
              )}>
                {(rowTotals[rowIndex] ?? 0) > 0 ? formatDuration(rowTotals[rowIndex]!) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/30">
            <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Total
            </td>
            {columnTotals.map((total, i) => (
              <td
                key={days[i]?.date ?? i}
                className={cn(
                  "px-2 py-2.5 text-center font-mono text-sm font-semibold tabular-nums",
                  days[i]?.isToday && "bg-primary/5",
                  total > 0 ? "text-foreground" : "text-muted-foreground/40",
                )}
              >
                {total > 0 ? formatDuration(total) : "—"}
              </td>
            ))}
            <td className="px-3 py-2.5 text-center font-mono text-sm font-bold tabular-nums text-foreground">
              {formatDuration(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
