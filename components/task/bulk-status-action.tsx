"use client";

// F186 (AS-337): the first bulk action rendered into F185's
// <BulkActionBar> children slot — a status Select that applies to every
// currently-selected task in one `bulkUpdateTasks` call
// (lib/actions/tasks.ts). Mirrors list-status-select.tsx's Select markup
// (same STATUS_COLORS/STATUS_LABELS source) so a bulk change looks like
// the same control, just scoped to N tasks instead of one.
//
// F158 blocked-done guard: per this feature's Clarified implementation
// ("blocked-task confirmation is resolved before the call, not per row"),
// this component calls useBlockedDoneGuard().confirmIfMovingToDone for
// each selected task BEFORE calling bulkUpdateTasks — exactly the
// mechanism useBlockedDoneGuard's own doc comment anticipates for a
// future bulk caller. A task whose confirmation is cancelled is simply
// left out of the ids passed to bulkUpdateTasks; it is not counted as a
// server-side failure. When the target status isn't "done", every
// confirm call resolves immediately with no network cost (see that
// hook's own doc comment), so this loop is cheap for the common case.

import { useTransition } from "react";
import { toast } from "sonner";

import { bulkUpdateTasks } from "@/lib/actions/tasks";
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
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/task-colors";

const STATUS_OPTIONS: { value: TaskCardTask["status"]; label: string }[] = [
  { value: "todo", label: STATUS_LABELS.todo },
  { value: "in_progress", label: STATUS_LABELS.in_progress },
  { value: "in_review", label: STATUS_LABELS.in_review },
  { value: "done", label: STATUS_LABELS.done },
];

export function BulkStatusAction({
  selectedIds,
  onDone,
}: {
  /** Task ids currently selected in <TaskListTable> (F185). */
  selectedIds: string[];
  /** Called once the action completes (success or partial success) so the
   * caller can clear the selection, mirroring BulkActionBar's own
   * onClear mechanism (F185/AS-342). */
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const { confirmIfMovingToDone, dialog: blockedDoneDialog } =
    useBlockedDoneGuard();
  const membership = useMembership();
  const canChangeStatus = membership
    ? canWrite({ role: membership.role })
    : true;

  async function handleChange(value: TaskCardTask["status"] | null) {
    if (value === null || selectedIds.length === 0) return;
    const nextStatus = value;

    // Resolved ONCE up front for the whole selection, not per row inside
    // the server call — see this component's doc comment above.
    const confirmedIds: string[] = [];
    for (const taskId of selectedIds) {
      const proceed = await confirmIfMovingToDone(taskId, nextStatus);
      if (proceed) confirmedIds.push(taskId);
    }
    if (confirmedIds.length === 0) return;

    startTransition(async () => {
      const result = await bulkUpdateTasks(confirmedIds, {
        status: nextStatus,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.failedIds.length > 0) {
        toast.warning(
          `Updated ${result.data.succeededIds.length} of ${confirmedIds.length} tasks. ${result.data.failedIds.length} couldn't be changed.`,
        );
      } else {
        toast.success(
          `Updated ${result.data.succeededIds.length} ${
            result.data.succeededIds.length === 1 ? "task" : "tasks"
          }.`,
        );
      }
      onDone();
    });
  }

  return (
    <>
      <Select onValueChange={handleChange}>
        <SelectTrigger
          size="sm"
          className="w-40"
          disabled={isPending || !canChangeStatus || selectedIds.length === 0}
          title={
            canChangeStatus
              ? undefined
              : "You don't have permission to change these tasks' status."
          }
          aria-label="Set status for selected tasks"
        >
          <SelectValue placeholder="Set status" />
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
