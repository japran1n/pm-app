"use client";

// F187 (AS-339, AS-340): the second bulk action rendered into F185's
// <BulkActionBar> children slot (alongside F186's <BulkStatusAction>) — a
// "Delete" button that soft-deletes every currently-selected task in one
// `bulkDeleteTasks` call (lib/actions/tasks.ts), after a confirmation
// dialog naming the count.
//
// AS-339: the dialog must name the count and must NOT fire the delete on
// the trigger button click itself — only Dialog's own "Move N tasks to
// trash" action button inside the dialog calls bulkDeleteTasks. The dialog
// deliberately says "Move ... to trash", never "Delete ... forever" — per
// this feature's own Clarified implementation, which explicitly calls out
// that "the wording matters": this is a soft delete (lib/actions/tasks.ts's
// deleteTask/bulkDeleteTasks convention), not permanent deletion, and the
// UI copy must say so.
//
// AS-340: a partial failure (some selected tasks forbidden, e.g. a private
// project the caller lost access to mid-selection) must name the FAILED
// tasks by their "PROJECTKEY-number" key (lib/tasks/task-key.ts's
// formatTaskKey, the one formatter for this string — never a raw uuid),
// and must not roll back the tasks that did succeed. bulkDeleteTasks
// itself already guarantees the "don't roll back successes" half (each
// forbidden task is excluded from the UPDATE, not the whole batch); this
// component's job is only to resolve `failedIds` (uuids) back to display
// keys using the `tasks` prop it was handed (the same rows the selection
// was made from — no second fetch needed) and surface them in the toast.

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { bulkDeleteTasks, bulkRestoreTasks } from "@/lib/actions/tasks";
import { canTeamWrite } from "@/lib/auth/permissions";
import { showUndoToast } from "@/lib/toast/undo-toast";
import { useMembership } from "@/components/auth/membership-provider";
import { formatTaskKey } from "@/lib/tasks/task-key";
import type { TaskCardTask } from "@/components/task/task-card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function BulkDeleteAction({
  selectedTasks,
  onDone,
}: {
  /** The full task rows (not just ids) currently selected in
   * <TaskListTable> (F185) — carries `projectKey`/`number` so a partial
   * failure can be reported by key (AS-340), not by raw uuid. */
  selectedTasks: Pick<TaskCardTask, "id" | "projectKey" | "number">[];
  /** Called once the action completes (success or partial success) so the
   * caller can clear the selection, mirroring BulkStatusAction's own
   * onDone/BulkActionBar's onClear mechanism (F185/AS-342). */
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const membership = useMembership();
  // AS-055: `canTeamWrite`, not `canDeleteTask` — matches
  // deleteTask/bulkDeleteTasks's own permission gate exactly (delete has
  // no per-task ownership restriction; owner/admin/member only).
  const canDelete = membership ? canTeamWrite({ role: membership.role }) : true;
  const selectedIds = selectedTasks.map((task) => task.id);
  const count = selectedIds.length;

  function handleConfirm() {
    if (selectedIds.length === 0) return;
    startTransition(async () => {
      const result = await bulkDeleteTasks(selectedIds);
      if (!result.ok) {
        toast.error(result.error);
        setOpen(false);
        return;
      }

      const { succeededIds, failedIds } = result.data;

      if (failedIds.length > 0) {
        const keyById = new Map(
          selectedTasks.map((task) => [
            task.id,
            formatTaskKey(task.projectKey, task.number),
          ]),
        );
        const failedLabels = failedIds.map(
          (failure) => keyById.get(failure.id) ?? failure.id,
        );
        toast.warning(
          `Moved ${succeededIds.length} of ${count} tasks to trash. Couldn't delete: ${failedLabels.join(", ")}.`,
        );
      } else if (succeededIds.length > 0) {
        // F190 (AS-345): "Bulk deletes undo the whole batch in one call" —
        // Undo here fires exactly one bulkRestoreTasks call with every
        // succeeded id, not a client-side loop of single restores.
        showUndoToast({
          message: `Moved ${succeededIds.length} ${
            succeededIds.length === 1 ? "task" : "tasks"
          } to trash.`,
          onUndo: async () => {
            const restoreResult = await bulkRestoreTasks(succeededIds);
            if (!restoreResult.ok) {
              toast.error(restoreResult.error);
              return;
            }
            const {
              succeededIds: restoredIds,
              failedIds: restoreFailedIds,
            } = restoreResult.data;
            if (restoreFailedIds.length > 0) {
              toast.warning(
                `Restored ${restoredIds.length} of ${succeededIds.length} tasks. Some couldn't be restored.`,
              );
            } else {
              toast.success(
                `Restored ${restoredIds.length} ${
                  restoredIds.length === 1 ? "task" : "tasks"
                }.`,
              );
            }
          },
        });
      }

      setOpen(false);
      onDone();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={isPending || !canDelete || count === 0}
            title={
              canDelete
                ? undefined
                : "You don't have permission to delete these tasks."
            }
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Move {count} {count === 1 ? "task" : "tasks"} to trash?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1 ? "This task" : "These tasks"} will be moved to
            trash, not permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={(event) => {
              // AS-339: the delete only proceeds on this explicit
              // confirmation click, never on the trigger click that opened
              // the dialog — `handleConfirm` is not wired to anything
              // outside this button.
              event.preventDefault();
              handleConfirm();
            }}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Moving to trash...
              </>
            ) : (
              `Move ${count === 1 ? "task" : "tasks"} to trash`
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
