"use client";

// F250 (AS-484, AS-485): the ONE shared optimistic-update + rollback +
// single-toast abstraction behind every inline-editable list-view cell
// that edits a single scalar field (priority, due date — see
// components/task/list-priority-select.tsx and
// components/task/list-due-date-cell.tsx). It factors out exactly the
// "set local value immediately, call the Server Action, reconcile or
// revert-with-toast on failure" pattern components/task/list-status-
// select.tsx and components/task/tags-editor.tsx already hand-write
// individually (F057/F041), so a third and fourth field type didn't need
// a third and fourth copy of it — this is the "one inline-cell
// abstraction shared by all four field types" this feature's Clarified
// implementation asks for.
//
// AS-484's fourth field (assignee) is a *set* rather than a scalar (add/
// remove multiple ids) and status already has its own working, tested
// copy of this exact pattern — per this feature's "Touches"/scope note,
// components/task/list-status-select.tsx is extended, not forked, and is
// left as-is rather than risking its passing F106/F223 tests by
// retrofitting it onto this hook. See this feature's handoff for the
// full rationale.
//
// Duplicate-commit guard: `commit()` is called from both an Enter
// keydown (which then blurs the field, itself triggering an onBlur
// handler that also calls commit()) and a plain blur with no Enter — the
// pending-value ref below makes a second call for the SAME in-flight
// value a no-op rather than firing the Server Action twice.
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

export type InlineFieldActionResult<V> =
  | { ok: true; data: V }
  | { ok: false; error: string };

export function useInlineFieldEdit<V>({
  taskId,
  value,
  action,
}: {
  /** The task this field belongs to — used only to detect a prop change
   * to a DIFFERENT task (row virtualization / list re-sort), which
   * re-syncs local state from the fresh `value` rather than carrying a
   * stale edit across rows. */
  taskId: string;
  /** The field's current server value, as rendered by the caller. */
  value: V;
  /** Persists `value` for `taskId`, returning the value actually written
   * (which may differ slightly from what was requested — e.g. a trimmed
   * string) so local state re-syncs to the authoritative result rather
   * than blindly trusting the optimistic guess. */
  action: (taskId: string, value: V) => Promise<InlineFieldActionResult<V>>;
}) {
  const [localValue, setLocalValue] = useState(value);
  // Tracked as state (not a ref) so reading it during render — the
  // hook's own return value — never trips the "no ref access during
  // render" rule; only `commit()` (an event-handler-triggered async
  // callback, never render itself) writes to it.
  const [committedValue, setCommittedValue] = useState(value);
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  // Refs are fine here: both are read/written ONLY from inside `commit()`
  // (never during render), purely to de-duplicate a second commit() call
  // for the same in-flight value (see this file's header comment).
  const isPendingRef = useRef(false);
  const pendingValueRef = useRef(value);
  const [isSaving, startTransition] = useTransition();

  // Adjust state during render on prop change — same convention as
  // ListStatusSelect/TagsEditor's own `syncedTaskId` re-sync.
  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalValue(value);
    setCommittedValue(value);
  }

  function commit(nextValue: V) {
    if (nextValue === committedValue) return;
    if (isPendingRef.current && nextValue === pendingValueRef.current) return;

    const previous = committedValue;
    isPendingRef.current = true;
    pendingValueRef.current = nextValue;
    setLocalValue(nextValue);

    startTransition(async () => {
      const result = await action(taskId, nextValue);
      isPendingRef.current = false;
      if (result.ok) {
        setCommittedValue(result.data);
        setLocalValue(result.data);
      } else {
        // Revert optimistic update on failure + exactly one toast, same
        // convention as board.tsx's handleDragEnd.
        setCommittedValue(previous);
        setLocalValue(previous);
        toast.error(result.error);
      }
    });
  }

  /** Reverts any uncommitted local edit back to the last known-good
   * (committed) value — used for Escape. */
  function revert() {
    setLocalValue(committedValue);
  }

  return {
    localValue,
    setLocalValue,
    isSaving,
    commit,
    revert,
    committedValue,
  };
}
