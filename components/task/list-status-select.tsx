"use client";

// F057 (AS-093): inline status editor for a task row in the project List
// view. Smallest-possible-client-boundary component, same convention as
// components/task/tags-editor.tsx (F041) and
// components/task/due-date-sort-header.tsx (F055) — <TaskListTable> itself
// stays a Server Component (AS-155) and only this per-row status cell is a
// Client Component.
//
// Calls `moveTaskStatus` (lib/actions/tasks.ts, F045: AS-069) directly —
// the same Server Action the board's drag-and-drop already uses to change
// a task's status. Reusing it here means the board view reflects a list
// view status edit "for free": `moveTaskStatus` already calls
// `revalidatePath(`/w/${slug}`, "layout")` on success, which invalidates
// both the list and board routes since they're nested under that layout
// segment. No new Server Action was needed for this feature.
//
// Optimistic update + revert-on-failure mirrors TagsEditor's `persist`
// pattern: the local status is applied immediately so the row re-renders
// without a full page reload, then reconciled (or reverted, with a toast)
// once the Server Action resolves.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { moveTaskStatus } from "@/lib/actions/tasks";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { useBlockedDoneGuard } from "@/components/task/blocked-done-guard";
import type { TaskCardTask } from "@/components/task/task-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// F106 (AS-135): status labels/colors come from the single shared
// lib/task-colors.ts constant (same source as BoardColumn's header dot
// and the dashboard's status pie chart) instead of this component's own
// local STATUS_OPTIONS labels, which previously rendered no color at all.
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/task-colors";

const STATUS_OPTIONS: { value: TaskCardTask["status"]; label: string }[] = [
  { value: "todo", label: STATUS_LABELS.todo },
  { value: "in_progress", label: STATUS_LABELS.in_progress },
  { value: "in_review", label: STATUS_LABELS.in_review },
  { value: "done", label: STATUS_LABELS.done },
];

export function ListStatusSelect({
  taskId,
  status,
}: {
  taskId: string;
  status: TaskCardTask["status"];
}) {
  const [localStatus, setLocalStatus] = useState(status);
  // Re-sync local state if the row's underlying status changes via a fresh
  // server render (e.g. another user's edit) for a task this instance is
  // still mounted for — same "adjust state during render on prop change"
  // convention as TagsEditor's syncedTaskId.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [isSaving, startSaveTransition] = useTransition();
  // F158 (AS-280, AS-281): the shared guard — see lib/tasks/
  // blocked-guard.ts's isDoneStatus doc comment for the full list of
  // callers this same hook is shared with.
  const { confirmIfMovingToDone, dialog: blockedDoneDialog } =
    useBlockedDoneGuard();

  // F135 (AS-231): this row's status select is rendered straight from the
  // initial Server Component list fetch (TaskListTable) with no per-row
  // role prop available — the membership context (see
  // membership-provider.tsx) is exactly the case it exists for. `null` (no
  // provider, e.g. an existing test) is treated as permissive.
  const membership = useMembership();
  const canChangeStatus = membership
    ? canWrite({ role: membership.role })
    : true;

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalStatus(status);
  }

  async function handleChange(value: TaskCardTask["status"] | null) {
    if (value === null || value === localStatus) return;
    const nextStatus = value;

    // F158: checked BEFORE any optimistic update, so a cancelled
    // confirmation never has to revert a value the Select already showed
    // — confirmIfMovingToDone resolves immediately with no network call
    // at all when nextStatus isn't "done".
    const proceed = await confirmIfMovingToDone(taskId, nextStatus);
    if (!proceed) return;

    const previousStatus = localStatus;
    setLocalStatus(nextStatus);
    startSaveTransition(async () => {
      const result = await moveTaskStatus(taskId, nextStatus);
      if (result.ok) {
        setLocalStatus(result.data.status as TaskCardTask["status"]);
      } else {
        // Revert optimistic update on failure.
        setLocalStatus(previousStatus);
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Select value={localStatus} onValueChange={handleChange}>
        <SelectTrigger
          size="sm"
          className="w-36"
          disabled={isSaving || !canChangeStatus}
          title={
            canChangeStatus
              ? undefined
              : "You don't have permission to change this task's status."
          }
          aria-label={`Change status for task ${taskId}`}
        >
          <span className="flex items-center gap-1.5 overflow-hidden">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[localStatus] }}
            />
            <SelectValue>
              {(value: string) =>
                STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? value
              }
            </SelectValue>
          </span>
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[option.value] }}
                />
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {blockedDoneDialog}
    </>
  );
}
