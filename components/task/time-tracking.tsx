"use client";

// F113 (AS-171): task time-tracking section — total logged time, a
// start/stop timer control, a manual "log time" mini-form, and this task's
// time entry list with per-entry edit/delete affordances gated by F112's
// rules.
//
// Pattern: same deviation from the clarified spec's default ("Server
// Component for data-fetching, thin Client Component only for the
// interactive part") that CommentList (F060) and AttachmentList (F066)
// document — this component is composed *inside*
// components/task/task-detail-sheet.tsx (F039), which is already a Client
// Component. The caller (a future Server Component page) fetches this
// task's time entries (lib/actions/time-entries.ts has no list query yet —
// a future feature can add lib/queries/time-entries.ts's getTaskTimeEntries;
// until then the caller passes whatever it has, defaulting to empty) and
// the viewer's own active timer (F111's getActiveTimer) and passes both
// down as props; this component owns rendering plus all the interactive
// state, appending/removing entries in local state (optimistic-update
// convention matching CommentList/AttachmentList) rather than re-fetching.
//
// Total (AS-171): computed by summing `timeEntries[].minutes` on every
// render rather than requiring a separate aggregate query/prop — the spec
// explicitly allows "compute from a passed-in list", and this keeps the
// total trivially consistent with whatever's already rendered in the list
// below (no separate round trip that could disagree with the list).
//
// Timer state (Clarified implementation): `activeTimer` is a lightweight
// { taskId, startedAt } | null — deliberately NOT the full F111
// `ActiveTimer` query type (which also carries joined task title/project),
// since this component only needs to know (a) is there a running timer at
// all, and (b) is it running on *this* task, to decide between "Start
// timer" / "Stop" + elapsed / "Timer running on another task". The
// elapsed counter is a client-side setInterval purely for DISPLAY,
// re-rendering once a second — the source of truth stays the server's
// `started_at` (recomputed correctly by stop_timer_atomic on every
// stop/reload), never accumulated client-side, so clock drift or a missed
// tick can never desync the eventually-logged minutes (AS-167, AS-168).
//
// Edit/delete visibility (F112): editTimeEntry is author-only (AS-169, no
// admin override — see lib/actions/time-entries.ts's own doc comment on
// why this is deliberately stricter than comments), deleteTimeEntry is
// author-or-admin/owner (AS-170). Both are UI-affordance-only; the actions
// themselves independently re-check authorization server-side regardless
// (same "hiding the button is the UX half, the Server Action call is the
// enforcement half" convention as CommentList's canDelete).

import { useEffect, useState, useTransition } from "react";
import {
  Clock,
  Loader2,
  Play,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import {
  deleteTimeEntry,
  editTimeEntry,
  logTimeEntry,
  startTimer,
  stopTimer,
} from "@/lib/actions/time-entries";
import { formatDuration } from "@/lib/time/format-duration";
// F167 (AS-300, AS-301, AS-302): the single ratio/flag source shared with
// TaskCard's over-estimate badge — see that file's doc comment for the
// null-means-no-estimate contract.
import { getEstimateProgress } from "@/lib/tasks/estimate-progress";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type TimeEntry = {
  id: string;
  taskId: string;
  userId: string;
  minutes: number;
  billable: boolean;
  entryDate: string;
  note: string | null;
};

export type TimeTrackingMember = {
  userId: string;
  email: string | null;
  name: string | null;
};

/** Lightweight view of the caller's own active timer — see doc comment
 * above for why this is narrower than F111's full `ActiveTimer` type. */
export type TimeTrackingActiveTimer = {
  taskId: string;
  startedAt: string;
};

function personLabel(
  userId: string,
  members: TimeTrackingMember[],
): string {
  const member = members.find((m) => m.userId === userId);
  return member?.name || member?.email || userId;
}

function todayDateString(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function formatEntryDate(entryDate: string): string {
  const date = new Date(`${entryDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return entryDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatElapsed(startedAt: string, now: number): string {
  const startMs = new Date(startedAt).getTime();
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now - startMs) / 1000),
  );
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

function sortedNewestFirst(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.entryDate !== b.entryDate) {
      return a.entryDate < b.entryDate ? 1 : -1;
    }
    return 0;
  });
}

export function TimeTracking({
  taskId,
  timeEntries,
  members,
  estimateMinutes = null,
  activeTimer = null,
  currentUserId,
  currentUserRole,
  onActiveTimerChange,
}: {
  taskId: string;
  /** This task's time entries. Defaults handled by caller — an empty array
   * is a valid state (no time logged yet). */
  timeEntries: TimeEntry[];
  /** Workspace members, used to resolve each entry's person display. */
  members: TimeTrackingMember[];
  /** F167 (AS-300, AS-301, AS-302): this task's `estimate_minutes`
   * (F166), or null/undefined when no estimate is set — the "no estimate"
   * empty state (AS-302: logged time only, no bar, no flag) is the safe
   * default, same "caller hasn't fetched it yet" convention as
   * `activeTimer` below. */
  estimateMinutes?: number | null;
  /** F111 (AS-168): the viewer's own active timer, if any, anywhere in the
   * workspace (not necessarily on this task). `null`/undefined (caller
   * hasn't fetched it yet) is treated as "no active timer" — a safe
   * default, same convention as CommentList/AttachmentList's optional
   * props, though it means a caller that skips this prop won't reflect a
   * timer truly running elsewhere until it re-fetches. */
  activeTimer?: TimeTrackingActiveTimer | null;
  /** F112 (AS-169, AS-170): the viewer's own user id. Edit is only shown
   * when this equals an entry's userId; delete is shown for that OR
   * admin/owner. Undefined hides both affordances entirely. */
  currentUserId?: string;
  /** F128 (AS-216): widened to the full `WorkspaceRole` so the
   * start-timer/log-time controls can be disabled for a read-only caller —
   * the server (`startTimer`/`stopTimer`/`logTimeEntry`) independently
   * rejects the call regardless. */
  currentUserRole?: WorkspaceRole;
  /** Notifies the caller when this component starts/stops a timer, so a
   * parent tracking active-timer state elsewhere (e.g. a global "timer
   * running" indicator) can stay in sync without a full re-fetch. */
  onActiveTimerChange?: (timer: TimeTrackingActiveTimer | null) => void;
}) {
  const [localEntries, setLocalEntries] = useState(timeEntries);
  const [localActiveTimer, setLocalActiveTimer] =
    useState<TimeTrackingActiveTimer | null>(activeTimer);
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);

  const [minutesDraft, setMinutesDraft] = useState("");
  const [billableDraft, setBillableDraft] = useState(true);
  const [dateDraft, setDateDraft] = useState(todayDateString());
  const [noteDraft, setNoteDraft] = useState("");

  const [isStartingOrStopping, startTimerTransition] = useTransition();
  const [isLogging, startLogTransition] = useTransition();
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [, startDeleteTransition] = useTransition();
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState("");
  const [editBillable, setEditBillable] = useState(true);
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");
  const [isSavingEdit, startEditTransition] = useTransition();

  const [now, setNow] = useState(() => Date.now());

  // Re-sync local state whenever the task changes, same "adjust state
  // during render on prop change" convention as CommentList/
  // TaskDetailSheet's syncedTaskId.
  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalEntries(timeEntries);
    setLocalActiveTimer(activeTimer);
    setMinutesDraft("");
    setDateDraft(todayDateString());
    setNoteDraft("");
    setEditingEntryId(null);
  }

  const runningHere = localActiveTimer?.taskId === taskId;

  // Live-updating elapsed counter — client-side setInterval purely for
  // DISPLAY (Clarified implementation), only ticking while a timer is
  // running on THIS task's view.
  useEffect(() => {
    if (!runningHere) return;
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [runningHere]);

  const totalMinutes = localEntries.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );

  // F167 (AS-300, AS-301, AS-302): null when no estimate is set — the
  // estimate row/progress bar/over-estimate badge below all key off this
  // single value being null vs. present, never re-deriving the check
  // themselves.
  const estimateProgress = getEstimateProgress(estimateMinutes, totalMinutes);

  function handleStartOrSwitch() {
    startTimerTransition(async () => {
      const result = await startTimer(taskId);
      if (result.ok) {
        const next: TimeTrackingActiveTimer = {
          taskId: result.data.taskId,
          startedAt: result.data.startedAt,
        };
        setLocalActiveTimer(next);
        setNow(Date.now());
        onActiveTimerChange?.(next);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleStop() {
    startTimerTransition(async () => {
      const result = await stopTimer();
      if (result.ok) {
        setLocalActiveTimer(null);
        onActiveTimerChange?.(null);
        if (result.data.taskId === taskId) {
          setLocalEntries((previous) => [
            ...previous,
            {
              id: result.data.id,
              taskId: result.data.taskId,
              userId: result.data.userId,
              minutes: result.data.minutes,
              billable: result.data.billable,
              entryDate: result.data.entryDate,
              note: result.data.note,
            },
          ]);
        }
        toast.success("Timer stopped.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleLogSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const minutes = Number.parseInt(minutesDraft, 10);
    if (!Number.isFinite(minutes) || minutes <= 0 || !dateDraft) return;

    startLogTransition(async () => {
      const result = await logTimeEntry(
        taskId,
        minutes,
        billableDraft,
        dateDraft,
        noteDraft.trim() || undefined,
      );
      if (result.ok) {
        setLocalEntries((previous) => [
          ...previous,
          {
            id: result.data.id,
            taskId: result.data.taskId,
            userId: result.data.userId,
            minutes: result.data.minutes,
            billable: result.data.billable,
            entryDate: result.data.entryDate,
            note: result.data.note,
          },
        ]);
        setMinutesDraft("");
        setBillableDraft(true);
        setDateDraft(todayDateString());
        setNoteDraft("");
        toast.success("Time logged.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function isAdminOrOwner(): boolean {
    return currentUserRole === "owner" || currentUserRole === "admin";
  }

  // F128 (AS-216): viewers/guests never see usable start-timer/log-time/
  // edit/delete controls.
  const canTrackTime = currentUserRole
    ? canWrite({ role: currentUserRole })
    : true;

  function canEdit(entry: TimeEntry): boolean {
    if (!currentUserId || !canTrackTime) return false;
    return entry.userId === currentUserId;
  }

  function canDelete(entry: TimeEntry): boolean {
    if (!currentUserId || !canTrackTime) return false;
    return entry.userId === currentUserId || isAdminOrOwner();
  }

  function startEdit(entry: TimeEntry) {
    setEditingEntryId(entry.id);
    setEditMinutes(String(entry.minutes));
    setEditBillable(entry.billable);
    setEditDate(entry.entryDate);
    setEditNote(entry.note ?? "");
  }

  function cancelEdit() {
    setEditingEntryId(null);
  }

  function handleEditSave(entryId: string) {
    const minutes = Number.parseInt(editMinutes, 10);
    if (!Number.isFinite(minutes) || minutes <= 0 || !editDate) return;

    startEditTransition(async () => {
      const result = await editTimeEntry(entryId, {
        minutes,
        billable: editBillable,
        entryDate: editDate,
        note: editNote.trim() || null,
      });
      if (result.ok) {
        setLocalEntries((previous) =>
          previous.map((entry) =>
            entry.id === entryId
              ? {
                  id: result.data.id,
                  taskId: result.data.taskId,
                  userId: result.data.userId,
                  minutes: result.data.minutes,
                  billable: result.data.billable,
                  entryDate: result.data.entryDate,
                  note: result.data.note,
                }
              : entry,
          ),
        );
        setEditingEntryId(null);
        toast.success("Time entry updated.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(entryId: string) {
    setDeletingEntryId(entryId);
    startDeleteTransition(async () => {
      const result = await deleteTimeEntry(entryId);
      if (result.ok) {
        setLocalEntries((previous) =>
          previous.filter((entry) => entry.id !== entryId),
        );
      } else {
        toast.error(result.error);
      }
      setDeletingEntryId(null);
    });
  }

  const orderedEntries = sortedNewestFirst(localEntries);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Time tracked</Label>
        <span
          className="inline-flex items-center gap-1.5 text-sm font-medium"
          data-testid="time-tracking-total"
        >
          <Clock className="size-4" aria-hidden="true" />
          {formatDuration(totalMinutes)}
        </span>
      </div>

      {/* F167 (AS-300, AS-301, AS-302): estimate row — only rendered when
          an estimate is set (estimateProgress is non-null); a task with no
          estimate shows nothing more here beyond the logged-time total
          above (AS-302). */}
      {estimateProgress && (
        <div className="flex flex-col gap-1.5" data-testid="estimate-progress">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {formatDuration(totalMinutes)} of{" "}
              {formatDuration(estimateMinutes as number)} estimated
            </span>
            {estimateProgress.isOverEstimate && (
              <span
                className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-500"
                data-testid="over-estimate-badge"
              >
                <TriangleAlert className="size-3" aria-hidden="true" />
                Over estimate
              </span>
            )}
          </div>
          <div
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={estimateProgress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${estimateProgress.percent}% of estimate logged`}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                estimateProgress.isOverEstimate
                  ? "bg-amber-500"
                  : "bg-foreground/70",
              )}
              style={{ width: `${estimateProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Start/stop timer control */}
      <div className="flex flex-col gap-2">
        {runningHere ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isStartingOrStopping || !canTrackTime}
              title={canTrackTime ? undefined : "Viewers can't track time"}
              onClick={handleStop}
            >
              {isStartingOrStopping ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Square className="size-4" aria-hidden="true" />
              )}
              Stop
            </Button>
            <span className="font-mono text-sm text-muted-foreground">
              {localActiveTimer
                ? formatElapsed(localActiveTimer.startedAt, now)
                : null}
            </span>
          </div>
        ) : localActiveTimer ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              Timer running on another task.
            </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              disabled={isStartingOrStopping || !canTrackTime}
              title={canTrackTime ? undefined : "Viewers can't track time"}
              onClick={handleStartOrSwitch}
            >
              Switch here
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isStartingOrStopping || !canTrackTime}
            title={canTrackTime ? undefined : "Viewers can't track time"}
            onClick={handleStartOrSwitch}
          >
            {isStartingOrStopping ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            Start timer
          </Button>
        )}
      </div>

      {/* Manual log-time mini-form */}
      <form
        onSubmit={handleLogSubmit}
        className="flex flex-col gap-2 rounded-md border border-border/60 p-3"
        aria-label="Log time manually"
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`time-minutes-${taskId}`} className="text-xs">
              Minutes
            </Label>
            <Input
              id={`time-minutes-${taskId}`}
              type="number"
              min={1}
              step={1}
              className="w-24"
              value={minutesDraft}
              disabled={isLogging || !canTrackTime}
              onChange={(event) => setMinutesDraft(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`time-date-${taskId}`} className="text-xs">
              Date
            </Label>
            <Input
              id={`time-date-${taskId}`}
              type="date"
              className="w-40"
              value={dateDraft}
              disabled={isLogging || !canTrackTime}
              onChange={(event) => setDateDraft(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 pb-2">
            <input
              id={`time-billable-${taskId}`}
              type="checkbox"
              className="size-4 rounded border-input"
              checked={billableDraft}
              disabled={isLogging || !canTrackTime}
              onChange={(event) => setBillableDraft(event.target.checked)}
            />
            <Label htmlFor={`time-billable-${taskId}`} className="text-xs">
              Billable
            </Label>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`time-note-${taskId}`} className="text-xs">
            Note (optional)
          </Label>
          <Input
            id={`time-note-${taskId}`}
            value={noteDraft}
            disabled={isLogging || !canTrackTime}
            onChange={(event) => setNoteDraft(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          className="self-start"
          disabled={
            isLogging ||
            !minutesDraft ||
            Number.parseInt(minutesDraft, 10) <= 0 ||
            !dateDraft
          }
        >
          {isLogging ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            "Log time"
          )}
        </Button>
      </form>

      {/* Time entry list */}
      {orderedEntries.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4" aria-hidden="true" />
          No time logged yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orderedEntries.map((entry) =>
            editingEntryId === entry.id ? (
              <li
                key={entry.id}
                className="flex flex-col gap-2 rounded-md border border-border/60 p-3"
              >
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    className="w-24"
                    aria-label="Minutes"
                    value={editMinutes}
                    disabled={isSavingEdit}
                    onChange={(event) => setEditMinutes(event.target.value)}
                  />
                  <Input
                    type="date"
                    className="w-40"
                    aria-label="Date"
                    value={editDate}
                    disabled={isSavingEdit}
                    onChange={(event) => setEditDate(event.target.value)}
                  />
                  <div className="flex items-center gap-1.5 pb-2">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input"
                      aria-label="Billable"
                      checked={editBillable}
                      disabled={isSavingEdit}
                      onChange={(event) =>
                        setEditBillable(event.target.checked)
                      }
                    />
                    <Label className="text-xs">Billable</Label>
                  </div>
                </div>
                <Input
                  aria-label="Note"
                  value={editNote}
                  disabled={isSavingEdit}
                  onChange={(event) => setEditNote(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSavingEdit}
                    onClick={() => handleEditSave(entry.id)}
                  >
                    {isSavingEdit ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      "Save"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSavingEdit}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </Button>
                </div>
              </li>
            ) : (
              <li key={entry.id} className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">
                    {personLabel(entry.userId, members)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(entry.minutes)}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {entry.billable ? "Billable" : "Non-billable"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatEntryDate(entry.entryDate)}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    {canEdit(entry) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => startEdit(entry)}
                      >
                        Edit
                      </Button>
                    )}
                    {canDelete(entry) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={deletingEntryId === entry.id}
                        aria-label="Delete time entry"
                        onClick={() => handleDelete(entry.id)}
                      >
                        {deletingEntryId === entry.id ? (
                          <Loader2
                            className="size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                {entry.note && (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {entry.note}
                  </p>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
