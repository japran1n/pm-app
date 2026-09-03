"use client";

// F002 (missions/20260903-portal, AS-013): "Move to phase" bulk action —
// the second control rendered into <BulkActionBar>'s children slot,
// mirroring bulk-status-action.tsx's own shape exactly (fetch options,
// one Select, one bulk Server Action call, partial-success toast).

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { bulkSetTaskPhase, getProjectPhaseOptions } from "@/lib/actions/phases";
import type { ProjectPhaseOption } from "@/lib/queries/phases";
import { canEditTask } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Same reserved-sentinel convention as the other phase Selects in this
// feature (task-detail-sheet.tsx, new-task-dialog.tsx) — base-ui's Select
// doesn't accept an empty-string item value, and "clear the phase" is a
// real, selectable choice here too.
const NO_PHASE_VALUE = "__no_phase__";

export function BulkPhaseAction({
  projectId,
  selectedIds,
  onDone,
}: {
  /** The list view is project-scoped (task-list-table.tsx's own
   * `projectId` prop), so phase options come from exactly one project —
   * unlike bulk status changes, there's no cross-project ambiguity here. */
  projectId: string;
  /** Task ids currently selected in <TaskListTable> (F185). */
  selectedIds: string[];
  /** Called once the action completes (success or partial success) so the
   * caller can clear the selection, mirroring BulkStatusAction's own
   * onDone contract. */
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [phaseOptions, setPhaseOptions] = useState<ProjectPhaseOption[] | null>(
    null,
  );
  const membership = useMembership();
  // lib/actions/phases.ts's setTaskPhase/bulkSetTaskPhase gate on
  // `canEditTask` (the same predicate editTask itself uses for task-field
  // edits), not the phase-CRUD actions' default `canWrite` — this button's
  // enabled state must agree with that, not with the settings page's own
  // `canManage` gate.
  const canChangePhase = membership ? canEditTask({ role: membership.role }) : true;

  useEffect(() => {
    let cancelled = false;
    getProjectPhaseOptions(projectId).then((result) => {
      if (cancelled) return;
      setPhaseOptions(result.ok ? result.data.phases : []);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // A project with no phases yet has nothing to move tasks into — same
  // "don't render a control whose only real option is a no-op" convention
  // new-task-dialog.tsx's own phase Select uses.
  if (!phaseOptions || phaseOptions.length === 0) return null;

  function handleChange(value: string | null) {
    if (value === null || selectedIds.length === 0) return;
    const phaseId = value === NO_PHASE_VALUE ? null : value;

    startTransition(async () => {
      const result = await bulkSetTaskPhase(selectedIds, phaseId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.failedIds.length > 0) {
        toast.warning(
          `Moved ${result.data.succeededIds.length} of ${selectedIds.length} tasks. ${result.data.failedIds.length} couldn't be moved.`,
        );
      } else {
        toast.success(
          `Moved ${result.data.succeededIds.length} ${
            result.data.succeededIds.length === 1 ? "task" : "tasks"
          }.`,
        );
      }
      onDone();
    });
  }

  return (
    <Select onValueChange={handleChange}>
      <SelectTrigger
        size="sm"
        className="w-40"
        disabled={isPending || !canChangePhase || selectedIds.length === 0}
        title={
          canChangePhase
            ? undefined
            : "You don't have permission to move these tasks."
        }
        aria-label="Move selected tasks to phase"
      >
        <SelectValue placeholder="Move to phase" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PHASE_VALUE}>No phase</SelectItem>
        {phaseOptions.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
