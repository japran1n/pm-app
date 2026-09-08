"use client";

// Global "Track Time" header widget, modeled on ClickUp's own header time
// tracker (per this feature's spec): a clock icon in the app header that
// opens a popover with (1) a daily progress bar against a hardcoded 8h/day
// goal, (2) a combined "enter a duration or start a timer" input, (3) a
// task picker/date/notes/billable mini log-time form, (4) a day-grouped
// list of recent entries with per-row restart/delete, and (5) links out to
// "My Timesheet"/"Dashboard".
//
// Backend reuse (no new server actions beyond what F110/F111/F112 already
// shipped): logTimeEntry/startTimer/stopTimer/deleteTimeEntry from
// lib/actions/time-entries.ts, exactly the same calls
// components/task/time-tracking.tsx already makes — this widget is a
// second SURFACE for the same actions, not a second implementation.
//
// Task search reuses the existing `searchPalette` Server Action
// (lib/actions/palette-search.ts) already powering HeaderSearch/the
// command palette — same "one query module, many surfaces" convention
// HeaderSearch's own header comment documents — filtered down to its
// `tasks` group, since this codebase has no separate
// "any task across any of my projects" combobox yet.
//
// Schema note (AUTONOMOUS_DECISION): `time_entries` has no start/end
// time-of-day columns (supabase/migrations/20260818151501_create_time_entries.sql
// — only `entry_date` + `minutes`), so unlike the ClickUp reference this
// widget's row list shows date + duration, not a "3:29pm - 3:39pm" range.
// A start/end-of-day column pair is out of scope here (would need a new
// migration) — see this feature's handoff for a suggested follow-up.
//
// Live-updating badge: a client-side `setInterval` re-rendering once a
// second purely for DISPLAY while a timer is running, same pattern (and
// same "source of truth stays the server's started_at" rule) as
// components/task/time-tracking.tsx's own elapsed counter.

import * as React from "react";
import { Clock, Loader2, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteTimeEntry,
  logTimeEntry,
  startTimer,
  stopTimer,
} from "@/lib/actions/time-entries";
import { searchPalette } from "@/lib/actions/palette-search";
import type { PaletteTaskResult } from "@/lib/palette/palette-search-types";
import type { ActiveTimer, MyRecentTimeEntry } from "@/lib/queries/time-entries";
import { formatDuration } from "@/lib/time/format-duration";
import { parseDurationToMinutes } from "@/lib/time/parse-duration";
import { formatTaskKey } from "@/lib/tasks/task-key";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The daily goal ClickUp's own "Track Time" panel shows as "Xh / 8h" — a
// hardcoded product default for now, per the clarified spec ("8h is
// default dnevni cilj — hardkoduj za sada, ne treba podešavanje po
// korisniku"), not a per-user setting.
const DAILY_GOAL_MINUTES = 8 * 60;

const DEBOUNCE_MS = 200;

export type GlobalTimeTrackerActiveTimer = {
  id: string;
  taskId: string;
  taskTitle: string;
  startedAt: string;
};

function todayDateString(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function formatElapsedClock(startedAt: string, now: number): string {
  const startMs = new Date(startedAt).getTime();
  const elapsedSeconds = Math.max(0, Math.floor((now - startMs) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function formatDayHeading(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function groupByDay(entries: MyRecentTimeEntry[]): Array<{
  day: string;
  totalMinutes: number;
  entries: MyRecentTimeEntry[];
}> {
  const order: string[] = [];
  const byDay = new Map<string, MyRecentTimeEntry[]>();
  for (const entry of entries) {
    if (!byDay.has(entry.entryDate)) {
      byDay.set(entry.entryDate, []);
      order.push(entry.entryDate);
    }
    byDay.get(entry.entryDate)!.push(entry);
  }
  return order.map((day) => {
    const dayEntries = byDay.get(day)!;
    return {
      day,
      totalMinutes: dayEntries.reduce((sum, e) => sum + e.minutes, 0),
      entries: dayEntries,
    };
  });
}

export function GlobalTimeTracker({
  workspaceId,
  workspaceSlug,
  initialActiveTimer = null,
  initialRecentEntries = [],
}: {
  workspaceId: string;
  workspaceSlug: string;
  /** Fetched server-side on the header's initial render — see AppHeader. */
  initialActiveTimer?: GlobalTimeTrackerActiveTimer | null;
  initialRecentEntries?: MyRecentTimeEntry[];
}) {
  const [open, setOpen] = React.useState(false);
  const [activeTimer, setActiveTimer] =
    React.useState<GlobalTimeTrackerActiveTimer | null>(initialActiveTimer);
  const [entries, setEntries] = React.useState<MyRecentTimeEntry[]>(initialRecentEntries);
  const [now, setNow] = React.useState(() => Date.now());

  const [durationInput, setDurationInput] = React.useState("");
  const [selectedTask, setSelectedTask] = React.useState<PaletteTaskResult | null>(null);
  const [taskQuery, setTaskQuery] = React.useState("");
  const [taskResults, setTaskResults] = React.useState<PaletteTaskResult[]>([]);
  const [taskDropdownOpen, setTaskDropdownOpen] = React.useState(false);
  const [entryDate, setEntryDate] = React.useState(todayDateString());
  const [note, setNote] = React.useState("");
  const [billable, setBillable] = React.useState(true);

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [restartingTaskId, setRestartingTaskId] = React.useState<string | null>(null);

  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRequestId = React.useRef(0);

  // Live-updating badge (Clarified spec item 5): tick once a second only
  // while a timer is actually running, same convention as
  // components/task/time-tracking.tsx's own elapsed counter.
  React.useEffect(() => {
    if (!activeTimer) return;
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [activeTimer]);

  React.useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const todayMinutes = entries
    .filter((entry) => entry.entryDate === todayDateString())
    .reduce((sum, entry) => sum + entry.minutes, 0);
  const goalPercent = Math.min(100, Math.round((todayMinutes / DAILY_GOAL_MINUTES) * 100));

  const groupedEntries = React.useMemo(() => groupByDay(entries), [entries]);

  function handleTaskQueryChange(value: string) {
    setTaskQuery(value);
    setSelectedTask(null);
    setTaskDropdownOpen(true);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const trimmed = value.trim();
    if (!trimmed) {
      latestRequestId.current += 1;
      setTaskResults([]);
      return;
    }

    const requestId = ++latestRequestId.current;
    debounceTimer.current = setTimeout(() => {
      searchPalette(workspaceId, trimmed)
        .then((result) => {
          if (requestId !== latestRequestId.current) return;
          setTaskResults(result.tasks);
        })
        .catch((error) => {
          console.error("GlobalTimeTracker: task search failed:", error);
          if (requestId !== latestRequestId.current) return;
          setTaskResults([]);
        });
    }, DEBOUNCE_MS);
  }

  function pickTask(task: PaletteTaskResult) {
    setSelectedTask(task);
    setTaskQuery(task.title);
    setTaskDropdownOpen(false);
  }

  function handlePlayPause() {
    if (activeTimer) {
      handleStop();
      return;
    }

    const trimmed = durationInput.trim();
    if (trimmed) {
      handleSave();
      return;
    }

    if (!selectedTask) {
      toast.error("Select a task to start a timer.");
      return;
    }

    setIsSubmitting(true);
    startTimer(selectedTask.id)
      .then((result) => {
        if (result.ok) {
          setActiveTimer({
            id: result.data.id,
            taskId: result.data.taskId,
            taskTitle: selectedTask.title,
            startedAt: result.data.startedAt,
          });
          setNow(Date.now());
        } else {
          toast.error(result.error);
        }
      })
      .finally(() => setIsSubmitting(false));
  }

  function handleStop() {
    setIsSubmitting(true);
    stopTimer()
      .then((result) => {
        if (result.ok) {
          setActiveTimer(null);
          setEntries((previous) => [
            {
              id: result.data.id,
              taskId: result.data.taskId,
              taskTitle: activeTimer?.taskTitle ?? "Task",
              minutes: result.data.minutes,
              billable: result.data.billable,
              entryDate: result.data.entryDate,
              note: result.data.note,
            },
            ...previous,
          ]);
          toast.success("Timer stopped.");
        } else {
          toast.error(result.error);
        }
      })
      .finally(() => setIsSubmitting(false));
  }

  function handleRestart(entry: MyRecentTimeEntry) {
    setRestartingTaskId(entry.id);
    startTimer(entry.taskId)
      .then((result) => {
        if (result.ok) {
          setActiveTimer({
            id: result.data.id,
            taskId: result.data.taskId,
            taskTitle: entry.taskTitle,
            startedAt: result.data.startedAt,
          });
          setNow(Date.now());
        } else {
          toast.error(result.error);
        }
      })
      .finally(() => setRestartingTaskId(null));
  }

  function handleSave() {
    if (!selectedTask) {
      toast.error("Select a task to log time.");
      return;
    }

    const minutes = parseDurationToMinutes(durationInput);
    if (!minutes) {
      toast.error("Enter a valid duration, e.g. 3h 20m.");
      return;
    }

    setIsSubmitting(true);
    logTimeEntry(selectedTask.id, minutes, billable, entryDate, note.trim() || undefined)
      .then((result) => {
        if (result.ok) {
          setEntries((previous) => [
            {
              id: result.data.id,
              taskId: result.data.taskId,
              taskTitle: selectedTask.title,
              minutes: result.data.minutes,
              billable: result.data.billable,
              entryDate: result.data.entryDate,
              note: result.data.note,
            },
            ...previous,
          ]);
          setDurationInput("");
          setNote("");
          toast.success("Time logged.");
        } else {
          toast.error(result.error);
        }
      })
      .finally(() => setIsSubmitting(false));
  }

  function handleDelete(entryId: string) {
    setDeletingId(entryId);
    deleteTimeEntry(entryId)
      .then((result) => {
        if (result.ok) {
          setEntries((previous) => previous.filter((entry) => entry.id !== entryId));
        } else {
          toast.error(result.error);
        }
      })
      .finally(() => setDeletingId(null));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Track Time"
            data-testid="global-time-tracker-trigger"
          />
        }
      >
        <Clock className="size-4" aria-hidden="true" />
        {activeTimer && (
          <span
            className="ml-1 font-mono text-micro tabular-nums text-muted-foreground"
            data-testid="global-time-tracker-live-badge"
          >
            {formatElapsedClock(activeTimer.startedAt, now)}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent className="w-96 max-h-[32rem] overflow-y-auto" align="end">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <h3 className="text-mini font-semibold">Track Time</h3>
              <span className="text-micro text-muted-foreground" data-testid="daily-progress-label">
                {formatDuration(todayMinutes)} / {formatDuration(DAILY_GOAL_MINUTES)}
              </span>
            </div>
            <div
              className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={goalPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${goalPercent}% of daily goal logged`}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
                style={{ width: `${goalPercent}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-border/60 p-2.5">
            <div className="flex items-center gap-2">
              <Input
                value={durationInput}
                onChange={(event) => setDurationInput(event.target.value)}
                placeholder="Enter time (ex: 3h 20m) or start timer"
                aria-label="Enter time or start timer"
                disabled={isSubmitting || !!activeTimer}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSave();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={activeTimer ? "Stop timer" : "Start timer"}
                disabled={isSubmitting}
                onClick={handlePlayPause}
              >
                {isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : activeTimer ? (
                  <Pause className="size-4" aria-hidden="true" />
                ) : (
                  <Play className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>

            <div className="relative flex flex-col gap-1">
              <Label htmlFor="global-time-tracker-task" className="text-micro">
                Select task
              </Label>
              <Input
                id="global-time-tracker-task"
                value={taskQuery}
                placeholder="Search a task…"
                autoComplete="off"
                role="combobox"
                aria-expanded={taskDropdownOpen}
                onChange={(event) => handleTaskQueryChange(event.target.value)}
                onFocus={() => {
                  if (taskQuery.trim()) setTaskDropdownOpen(true);
                }}
              />
              {taskDropdownOpen && taskResults.length > 0 && (
                <div
                  role="listbox"
                  className="absolute top-full left-0 z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                >
                  {taskResults.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      role="option"
                      aria-selected={selectedTask?.id === task.id}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pickTask(task);
                      }}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-mini hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="truncate">{task.title}</span>
                      <span className="ml-auto shrink-0 text-micro text-muted-foreground">
                        {formatTaskKey(task.projectKey, task.number) ?? task.projectName}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="global-time-tracker-date" className="text-micro">
                  Date
                </Label>
                <Input
                  id="global-time-tracker-date"
                  type="date"
                  className="w-36"
                  value={entryDate}
                  disabled={isSubmitting}
                  onChange={(event) => setEntryDate(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant={billable ? "secondary" : "outline"}
                size="icon"
                aria-pressed={billable}
                aria-label={billable ? "Billable" : "Non-billable"}
                title={billable ? "Billable" : "Non-billable"}
                disabled={isSubmitting}
                onClick={() => setBillable((current) => !current)}
              >
                $
              </Button>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="global-time-tracker-note" className="text-micro">
                Notes
              </Label>
              <Input
                id="global-time-tracker-note"
                value={note}
                disabled={isSubmitting}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            <Button
              type="button"
              size="sm"
              className="self-start"
              disabled={isSubmitting || !durationInput.trim() || !selectedTask}
              onClick={handleSave}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                "Save"
              )}
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            {groupedEntries.length === 0 ? (
              <p className="py-2 text-center text-mini text-muted-foreground">
                No time logged yet.
              </p>
            ) : (
              groupedEntries.map((group) => (
                <div key={group.day} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-micro font-medium text-muted-foreground">
                    <span>{formatDayHeading(group.day)}</span>
                    <span>{formatDuration(group.totalMinutes)}</span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {group.entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-mini hover:bg-muted/50"
                      >
                        <span className="min-w-0 flex-1 truncate">{entry.taskTitle}</span>
                        <span className="shrink-0 text-micro text-muted-foreground">
                          {formatDuration(entry.minutes)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          aria-label="Restart timer on this task"
                          disabled={restartingTaskId === entry.id || !!activeTimer}
                          onClick={() => handleRestart(entry)}
                        >
                          {restartingTaskId === entry.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Play className="size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          aria-label="Delete time entry"
                          disabled={deletingId === entry.id}
                          onClick={() => handleDelete(entry.id)}
                        >
                          {deletingId === entry.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t pt-2 text-mini">
            <a
              href={`/w/${workspaceSlug}/time/me?view=weekly`}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              My Timesheet
            </a>
            <a
              href={`/w/${workspaceSlug}/time/me`}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              Dashboard
            </a>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type { ActiveTimer };
