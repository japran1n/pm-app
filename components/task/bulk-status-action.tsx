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
//
// F1 (status-sitemap-audit mission, AS-1, AS-2): this control used to
// offer a hardcoded, dead 4-value set (todo/in_progress/in_review/done)
// that no longer exists on any migrated project's `project_statuses`.
// It now takes a `statusOptionsByProject` map — the SAME per-project
// options-map pattern components/task/my-task-status-cell.tsx already
// uses for a selection spanning multiple projects — keyed by project id,
// built by whichever caller has that data (TaskListTable, from either its
// own single-project `statusOptions` prop or the workspace-wide
// dashboard's own per-project batch fetch). The dropdown offers the UNION
// of every involved project's real statuses (deduplicated by name) so a
// mixed-project selection can still target any status any of its
// projects actually has; `bulkUpdateTasks` (lib/actions/tasks/bulk.ts)
// re-verifies the name against EACH task's own project before writing and
// reports (never silently drops) any task whose project doesn't have it
// (AS-2) — this component does not attempt to pre-filter the dropdown
// down to "only options common to every selected task's project", since
// that would hide a legitimate choice for the subset of the selection
// that DOES have it.
//
// Falls back to `DEFAULT_STATUS_OPTIONS` (list-status-select.tsx's own
// "current default set" fallback, not the dead legacy 4-value set) only
// when no real per-project data is available at all — never renders the
// old hardcoded options.

import { useMemo, useTransition } from "react";
import { toast } from "sonner";

import { bulkUpdateTasks } from "@/lib/actions/tasks";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { useBlockedDoneGuard } from "@/components/task/blocked-done-guard";
import { DEFAULT_STATUS_OPTIONS } from "@/components/task/list-status-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type BulkStatusOption = {
  value: string;
  label: string;
  color: string;
  category?: string | null;
  displayGroup?: string | null;
};

export function BulkStatusAction({
  selectedIds,
  onDone,
  taskProjectIds,
  statusOptionsByProject,
}: {
  /** Task ids currently selected in <TaskListTable> (F185). */
  selectedIds: string[];
  /** Called once the action completes (success or partial success) so the
   * caller can clear the selection, mirroring BulkActionBar's own
   * onClear mechanism (F185/AS-342). */
  onDone: () => void;
  /** F1 (AS-1): taskId -> that task's own project id, so this component
   * can resolve which project's real statuses/category apply to a given
   * selected task. Undefined/missing entries fall back to the union
   * dropdown's own DEFAULT_STATUS_OPTIONS-derived category resolution. */
  taskProjectIds?: Map<string, string | undefined>;
  /** F1 (AS-1): projectId -> that project's real `project_statuses`
   * columns (lib/queries/statuses.ts's getProjectColumns), covering every
   * project touched by the current selection. Built by the caller — see
   * this file's own doc comment above for where each caller sources it. */
  statusOptionsByProject?: Map<string, BulkStatusOption[]>;
}) {
  const [isPending, startTransition] = useTransition();
  const { confirmIfMovingToDone, dialog: blockedDoneDialog } =
    useBlockedDoneGuard();
  const membership = useMembership();
  const canChangeStatus = membership
    ? canWrite({ role: membership.role })
    : true;

  // AS-1: the union of every involved project's real statuses,
  // deduplicated by name (first occurrence wins for label/color) — falls
  // back to the current default set only when the caller has no real
  // per-project data at all for this selection.
  const statusOptions = useMemo(() => {
    const byValue = new Map<string, BulkStatusOption>();
    for (const options of statusOptionsByProject?.values() ?? []) {
      for (const option of options) {
        if (!byValue.has(option.value)) byValue.set(option.value, option);
      }
    }
    return byValue.size > 0 ? [...byValue.values()] : DEFAULT_STATUS_OPTIONS;
  }, [statusOptionsByProject]);

  async function handleChange(value: string | null) {
    if (value === null || selectedIds.length === 0) return;
    const nextStatus = value;

    // Resolved ONCE up front for the whole selection, not per row inside
    // the server call — see this component's doc comment above.
    const confirmedIds: string[] = [];
    for (const taskId of selectedIds) {
      // AS-1: resolve the target status's CATEGORY from this task's OWN
      // project, when known, so the blocked-done guard reacts to a
      // done-category status (e.g. "Approved"/"Completed"), not just the
      // literal string "done" — mirrors list-status-select.tsx's own
      // per-row resolution.
      const projectId = taskProjectIds?.get(taskId);
      const projectOptions = projectId
        ? statusOptionsByProject?.get(projectId)
        : undefined;
      const nextStatusCategory =
        (projectOptions ?? statusOptions).find(
          (option) => option.value === nextStatus,
        )?.category ?? undefined;
      const proceed = await confirmIfMovingToDone(
        taskId,
        nextStatus,
        nextStatusCategory,
      );
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
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: option.color }}
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
