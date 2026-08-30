"use client";

// F250 (AS-484, AS-485, AS-487): inline due-date editor for a task row in
// the project List view. Same smallest-possible-client-boundary
// convention as its priority/status siblings.
//
// Calls `editTask` (lib/actions/tasks.ts) with only `{ dueDate }` in
// `updates` — the same Server Action the task detail sheet's own due-date
// `<input type="date">` already uses (handleDueDateChange), and the same
// `YYYY-MM-DD` plain-string convention editTaskSchema validates
// server-side.
//
// F002 (AS-003, AS-004): uses `React.useOptimistic` directly, mirroring
// F001's list-priority-select.tsx conversion (see that file's own F001
// comment for the full rationale) instead of the shared lib/hooks/
// use-inline-field-edit.ts hook this cell previously used. A native
// `<input type="date">`'s onChange already fires once per finalized pick
// (browser date-picker UX), not per keystroke the way a text field would,
// so — per this feature's clarified "date picker closes on select; no
// separate confirm needed" — the change handler commits immediately
// instead of the old draft-state + separate onBlur/Enter commit step.
// `useOptimistic` derives its optimistic value from the `dueDate` prop
// itself, so a failed `editTask` call needs no manual revert: once the
// transition settles without that prop having changed, React automatically
// falls back to the base (server) value on the next render — the "revert
// to prior value" behaviour AS-004 asks for — this component only has to
// surface the `toast.error` alongside it.
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { editTask } from "@/lib/actions/tasks";
import { Input } from "@/components/ui/input";

export function ListDueDateCell({
  taskId,
  dueDate,
}: {
  taskId: string;
  dueDate: string | null;
}) {
  const membership = useMembership();
  const canEdit = membership ? canWrite({ role: membership.role }) : true;

  const [isSaving, startTransition] = useTransition();
  const [localValue, setOptimisticValue] = useOptimistic<string | null>(
    dueDate,
  );

  function handleChange(next: string | null) {
    if (next === localValue) return;

    startTransition(async () => {
      // AS-003: applied inside the transition so the cell renders the new
      // date immediately, before `editTask` resolves.
      setOptimisticValue(next);
      const result = await editTask(taskId, { dueDate: next });
      if (!result.ok) {
        // AS-004: no manual revert needed — `useOptimistic` falls back to
        // the base `dueDate` prop once this transition settles without
        // that prop having changed. Only the toast is this component's
        // responsibility.
        toast.error("Failed to update due date");
      }
    });
  }

  // F251 (AS-489): viewer/guest gets plain text, not a disabled input —
  // see list-priority-select.tsx's identical comment for the rationale.
  if (!canEdit) {
    return (
      <span className="h-8 px-2 text-xs text-muted-foreground">
        {localValue ?? "No due date"}
      </span>
    );
  }

  return (
    <Input
      type="date"
      aria-label={`Change due date for task ${taskId}`}
      value={localValue ?? ""}
      disabled={isSaving || !canEdit}
      title={
        canEdit
          ? undefined
          : "You don't have permission to change this task's due date."
      }
      // Follow-up decision: stop click propagation so interacting with the
      // date input doesn't also open the row's detail sheet underneath it
      // (same convention as the other list-view cells' TableCell wrapper).
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => handleChange(event.target.value || null)}
      className="h-8 w-36 text-xs"
    />
  );
}
