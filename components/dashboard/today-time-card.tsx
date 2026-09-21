"use client";

// Home dashboard "Tracked today" card (F008, AS-040..AS-043): shows the
// caller's total minutes logged today against a hardcoded 8h/day target
// (same DAILY_GOAL_MINUTES convention as components/time/global-time-tracker.tsx),
// plus the caller's currently-running timer (if any) with a live-ticking
// elapsed clock and a Stop button.
//
// Source of truth for the running timer stays the server's
// `active_timers.started_at` row (see lib/queries/time-entries.ts ->
// getActiveTimer) — the setInterval here is purely a once-a-second DISPLAY
// tick, never the thing driving state, exactly the pattern
// GlobalTimeTracker's own live badge already uses.
//
// AUTONOMOUS_DECISION: the clarified spec names `stopTimeEntry(entryId)` as
// the server action to call, but no such export exists in
// lib/actions/time-entries.ts. The real action is `stopTimer()` (no args —
// it looks up the caller's own active_timers row server-side via
// getCurrentUser(), same as startTimer/logTimeEntry), which is exactly what
// GlobalTimeTracker's own handleStop() already calls. Used that instead of
// inventing a new action or a new entryId param.
//
// AUTONOMOUS_DECISION: ActiveTimer (lib/queries/time-entries.ts) has no
// "task number" field (only task.id/title/projectId) — this codebase's
// task numbers are a separate per-project sequence resolved via
// formatTaskKey(projectKey, number), which getActiveTimer's query doesn't
// join. Rendering the task title alone (truncated) rather than block on a
// number that isn't available on this type; a follow-up could extend
// getActiveTimer's select to join task_key/number if the number becomes a
// hard requirement.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Square } from "lucide-react";
import { toast } from "sonner";

import { stopTimer } from "@/lib/actions/time-entries";
import type { ActiveTimer } from "@/lib/queries/time-entries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type TodayTimeCardProps = {
  todayMinutes: number;
  targetMinutes: number;
  activeTimer: ActiveTimer | null;
};

// Distinct from lib/time/format-duration's formatDuration (which renders 0
// minutes as terse "0m") because this card's clarified spec explicitly
// requires the empty state to read "0h 0m / 8h".
function formatHoursMinutes(totalMinutes: number): string {
  const safeMinutes =
    Number.isFinite(totalMinutes) && totalMinutes > 0
      ? Math.round(totalMinutes)
      : 0;
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}h ${minutes}m`;
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

export function TodayTimeCard({
  todayMinutes,
  targetMinutes,
  activeTimer,
}: TodayTimeCardProps) {
  const router = useRouter();
  const [now, setNow] = React.useState(() => Date.now());
  const [isStopping, setIsStopping] = React.useState(false);

  React.useEffect(() => {
    if (!activeTimer) return;
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [activeTimer]);

  const percent =
    targetMinutes > 0
      ? Math.min(100, Math.round((todayMinutes / targetMinutes) * 100))
      : 0;
  const targetLabel = `${Math.round(targetMinutes / 60)}h`;

  function handleStop() {
    setIsStopping(true);
    stopTimer()
      .then((result) => {
        if (result.ok) {
          toast.success("Timer stopped.");
          router.refresh();
        } else {
          toast.error(result.error);
        }
      })
      .finally(() => setIsStopping(false));
  }

  return (
    <Card data-testid="today-time-card">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Tracked today
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className="font-mono text-2xl tabular-nums"
          data-testid="today-time-total"
        >
          {formatHoursMinutes(todayMinutes)}{" "}
          <span className="text-muted-foreground">/ {targetLabel}</span>
        </div>

        <div
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${percent}% of daily goal logged`}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
            style={{ width: `${percent}%` }}
          />
        </div>

        {activeTimer ? (
          <div
            className="flex items-center gap-2 rounded-md border border-border/60 p-2.5"
            data-testid="today-time-active-timer"
          >
            <span
              className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-sm">
              {activeTimer.task.title}
            </span>
            <span
              className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground"
              data-testid="today-time-elapsed"
            >
              {formatElapsedClock(activeTimer.startedAt, now)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Stop timer"
              disabled={isStopping}
              onClick={handleStop}
            >
              <Square className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 rounded-md border border-dashed border-border/60 p-2.5 text-sm text-muted-foreground"
            data-testid="today-time-no-timer"
          >
            No active timer — start one from a task.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
