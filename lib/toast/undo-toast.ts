"use client";

// F190 (AS-345): a small shared helper for the "deleted, with an Undo
// affordance" sonner toast used after a task delete, a comment delete, and
// a bulk task delete — one implementation rather than three near-identical
// copies inline in each call site, per this feature's Clarified
// "dependencies on existing code" default (reuse existing primitives/
// patterns rather than a new parallel implementation per usage).
//
// <Toaster /> is mounted once in app/layout.tsx (a layout that persists
// across route navigations within the app), so a toast raised here already
// survives client-side navigation for its own lifetime without any extra
// wiring — confirmed by reading components/ui/sonner.tsx and its mount
// site rather than assumed.
//
// Duration: sonner's own library default (4000ms) is a comfortable delay
// for most feedback, but an Undo action needs enough time for a user to
// actually notice the toast, read it, and click before it's gone —
// AS-345's assertion is specifically that undo genuinely works, not just
// that a toast briefly appeared. 8000ms is used instead: still simple (a
// single duration constant, no timers or dependencies of its own), long
// enough to be actionable, short enough not to clutter the screen.
// AUTONOMOUS_DECISION: no duration was specified in the clarified answers,
// so this is the simplest default that still serves the assertion.
//
// Idempotency (this feature's Notes-for-clarification answer, applied
// here rather than left to every call site to re-implement): the `handled`
// flag below ensures a double-click on the toast's own Undo button (the
// only way to click it twice, since the toast is dismissed on first click)
// never fires the restore action a second time — no duplicate restore
// call, no loud "not found" error from a second attempt.
import { toast } from "sonner";

const UNDO_TOAST_DURATION_MS = 8000;

export function showUndoToast({
  message,
  onUndo,
}: {
  /** e.g. "Task deleted." / "Comment deleted." / "Moved 3 tasks to trash." */
  message: string;
  onUndo: () => void | Promise<void>;
}): void {
  let handled = false;

  const id = toast.success(message, {
    // Per this feature's Clarified copy requirement: undoing after the
    // toast itself has expired is still possible via the trash page, and
    // the toast's own copy says so.
    description: "Also available in Trash.",
    duration: UNDO_TOAST_DURATION_MS,
    action: {
      label: "Undo",
      onClick: () => {
        if (handled) return;
        handled = true;
        toast.dismiss(id);
        void onUndo();
      },
    },
  });
}
