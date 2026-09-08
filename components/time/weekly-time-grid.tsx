"use client";

// Harvest-style weekly time grid for the "My time" personal dashboard
// (app/(workspace)/w/[workspaceSlug]/time/me/page.tsx). Rows are the tasks
// the caller worked on this week (from their own time entries) UNIONED
// with every task currently assigned to them (so a task with zero hours
// logged yet still has a row to log into) -- columns are the 7 days of the
// Monday-start week, matching lib/calendar/week-grid.ts's own convention so
// this grid can never disagree with the calendar about which week "this
// week" is.
//
// Grid-cell-edit approach (AUTONOMOUS_DECISION -- see the page's own doc
// comment for the full rationale): clicking a cell opens a small inline
// input; submitting it calls the EXISTING `logTimeEntry` server action and
// always inserts a NEW time_entries row rather than upserting an existing
// one. A cell showing 2h30m from two prior 1h15m entries and then edited to
// "1h" therefore ends up as 3h30m (existing rows are never touched) -- an
// accumulating ledger, not a single mutable cell value. This keeps the
// feature to zero new server actions, per the spec's stated preference.
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

function parseHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Accept "1.5" (hours) or "1:30" (h:mm).
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

function GridCell({
  taskId,
  date,
  minutes,
  onLogged,
}: {
  taskId: string;
  date: string;
  minutes: number;
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
          "flex h-9 w-full items-center justify-center rounded text-mini tabular-nums hover-surface",
          minutes === 0 && "text-muted-foreground",
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
        className="h-8 w-16 text-center text-mini"
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
      <p className="p-4 text-mini text-muted-foreground">
        No tasks to log time against this week yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-mini" data-testid="weekly-time-grid">
        <thead>
          <tr>
            <th className="w-56 border-b p-2 text-left font-medium">Task</th>
            {days.map((day) => (
              <th
                key={day.date}
                className={cn(
                  "border-b p-2 text-center font-medium",
                  day.isToday && "text-primary",
                )}
              >
                {day.label}
              </th>
            ))}
            <th className="border-b p-2 text-center font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task, rowIndex) => (
            <tr key={task.id} className="border-b last:border-b-0">
              <td className="max-w-56 truncate p-2">
                <div className="flex flex-col">
                  <span className="truncate font-medium">{task.title}</span>
                  {task.projectName && (
                    <span className="truncate text-micro text-muted-foreground">
                      {task.projectName}
                    </span>
                  )}
                </div>
              </td>
              {days.map((day) => (
                <td key={day.date} className="p-1 text-center">
                  <GridCell
                    taskId={task.id}
                    date={day.date}
                    minutes={localMinutes[`${task.id}::${day.date}`] ?? 0}
                    onLogged={handleLogged}
                  />
                </td>
              ))}
              <td className="p-2 text-center font-medium tabular-nums">
                {formatDuration(rowTotals[rowIndex] ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="p-2 font-medium">Total</td>
            {columnTotals.map((total, i) => (
              <td key={days[i]?.date ?? i} className="p-2 text-center font-medium tabular-nums">
                {formatDuration(total)}
              </td>
            ))}
            <td className="p-2 text-center font-semibold tabular-nums">
              {formatDuration(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
