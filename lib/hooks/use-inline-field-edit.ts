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
//
// F251 (AS-488, AS-489): live-update / no-clobber rule. `value` is now
// also the seam another user's Realtime edit arrives through — the
// caller (a list-view cell) re-renders with a fresh `value` prop once
// TaskListTable reconciles an incoming `postgres_changes` event into its
// own `tasks` state (see components/task/use-list-realtime.ts). Resolution
// rule (AUTONOMOUS_DECISION, per this feature's clarified "take the
// simpler option that adds no new dependency and no second source of
// truth"):
//   - If this field has NO uncommitted local edit in progress
//     (`localValue === committedValue`) when a new `value` arrives, both
//     `localValue` and `committedValue` adopt it immediately — this is
//     what makes another user's edit "appear live" (AS-488) for every
//     cell nobody is actively touching.
//   - If this field DOES have an uncommitted local edit
//     (`localValue !== committedValue`, i.e. the user is mid-edit),
//     the remote value updates `committedValue` (so a subsequent Escape
//     reverts to the up-to-date server value, not a stale one, and a
//     duplicate/no-op commit is correctly detected against it) but never
//     touches `localValue` — the user's in-progress keystrokes are never
//     silently overwritten. Whichever value they eventually commit wins
//     as the newest server write, same last-write-wins semantics every
//     other mutation in this app already has (no merge, no lock).
//   - While a commit is in flight (`isSaving`), incoming remote values
//     are ignored entirely and left to `commit()`'s own resolution
//     (server-echoed `result.data`) once it settles, so a same-tick
//     Realtime echo of this client's own write can never race the
//     optimistic path.
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
  // F251: the last `value` this hook has already reconciled — tracked as
  // state (read during render, same rule as committedValue above) so an
  // unrelated re-render doesn't re-run the sync branch below every time.
  const [lastSeenValue, setLastSeenValue] = useState(value);
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
    setLastSeenValue(value);
  } else if (value !== lastSeenValue) {
    // F251 (AS-488, AS-489): a fresh server value arrived for the SAME
    // task — either another user's edit reconciled via Realtime, or this
    // page's own server-fetched props refreshing. See this file's header
    // comment for the no-clobber rule.
    setLastSeenValue(value);
    if (!isSaving) {
      setCommittedValue(value);
      if (localValue === committedValue) {
        setLocalValue(value);
      }
    }
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
