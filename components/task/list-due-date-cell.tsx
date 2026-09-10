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
// F007: retrofitted onto the shared lib/hooks/use-optimistic-action.ts
// hook — same useOptimistic + useTransition + toast-on-error behaviour
// this file's own F002 comment above describes, no longer hand-rolled.
import { useState } from "react";

import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { editTask } from "@/lib/actions/tasks";
import { useOptimisticAction } from "@/lib/hooks/use-optimistic-action";
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

  const [localValue, isSaving, runChange] = useOptimisticAction<
    string | null
  >(
    dueDate,
    async (next) => {
      const result = await editTask(taskId, { dueDate: next });
      // AS-004: no manual revert needed — the hook's `useOptimistic` falls
      // back to the base `dueDate` prop once this transition settles
      // without that prop having changed. Only the toast is this
      // component's responsibility, and the hook handles that too.
      return result.ok ? undefined : { error: "Failed to update due date" };
    },
    "Failed to update due date",
  );

  // UX fix (list page audit, Nalaz 2): a bare, empty `<input type="date">`
  // renders the browser's own locale placeholder pattern (e.g.
  // "dd. mm. yyyy.") directly in the cell, which reads as a broken/garbled
  // date rather than "no due date set". Instead, a task that has NO date
  // yet starts as a plain "Set date" text button; only once the user
  // actually means to pick a date does this swap to a real date input
  // (autofocused, and native browsers open the picker on focus), matching
  // this table's existing "inline edit starts as static text/button,
  // becomes an input on interaction" pattern (see the quick-add bar and
  // row rename above). Initialized from the base `dueDate` prop (not the
  // optimistic `localValue`) so a task that ALREADY has a date keeps
  // showing the input throughout — including transiently clearing it —
  // exactly like before this fix; only the "never had a date" case is new.
  const [isEditing, setIsEditing] = useState(Boolean(dueDate));

  function handleChange(next: string | null) {
    if (next === localValue) return;
    // AS-003: applied inside the hook's transition so the cell renders the
    // new date immediately, before `editTask` resolves.
    runChange(next);
  }

  // F251 (AS-489): viewer/guest gets plain text, not a disabled input —
  // see list-priority-select.tsx's identical comment for the rationale.
  if (!canEdit) {
    return (
      <span className="h-8 px-2 text-xs text-muted-foreground">
        {localValue ? (
          <span className="font-mono">{localValue}</span>
        ) : (
          "No due date"
        )}
      </span>
    );
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        aria-label={`Set due date for task ${taskId}`}
        onClick={(event) => {
          event.stopPropagation();
          setIsEditing(true);
        }}
        className="h-8 rounded-md px-2 text-xs text-muted-foreground hover-surface"
      >
        Set date
      </button>
    );
  }

  return (
    <Input
      type="date"
      autoFocus={isEditing && !localValue}
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
      onBlur={() => {
        // Nothing was picked — collapse back to the static "Set date"
        // button rather than leaving the raw empty date input (and its
        // placeholder pattern text) visible.
        if (!localValue) setIsEditing(false);
      }}
      className="h-8 w-36 text-xs"
    />
  );
}
