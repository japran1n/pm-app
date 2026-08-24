"use client";

// F158 (AS-280, AS-281): the ONE shared confirm-before-completing-a-
// blocked-task guard. Every path that can move a task to a done-category
// status calls THIS hook before calling its own mutation — board
// drag-and-drop (components/board/board.tsx), the list view's inline
// status select (components/task/list-status-select.tsx), and the task
// detail sheet's own status Select (components/task/
// task-detail-sheet.tsx). See lib/tasks/blocked-guard.ts's isDoneStatus
// doc comment for the full "one shared helper, not four copies" chain
// and the F222 "done" sweep note.
//
// Shape (per the worker brief's explicit instruction that this must be
// reusable by bulk update, F186, once it exists, without reimplementing
// it): confirmIfMovingToDone takes a single taskId + the status it's
// about to become, and returns a Promise<boolean> — true means "proceed"
// (either this isn't a move to done, or there are no open blockers, or
// the user confirmed anyway despite them), false means "the user
// cancelled, do not call the mutation". A future bulk-update action can
// call this once per selected task (awaiting each in turn, skipping any
// task whose confirm resolves false) without any change to this hook's
// own API — each task gets its own confirm turn, exactly like an
// individual status change already would. A single combined "N tasks,
// here is every blocker across all of them" dialog was considered and
// rejected for now: no caller needs it yet (this feature's three real
// call sites are all single-task), and building it today would be a
// second, unexercised code path — the simpler option per the
// clarification's "no second source of truth" default. See this
// feature's handoff for the full note.
//
// Data freshness: this ALWAYS fetches blockers fresh from the server at
// confirm-time (lib/actions/tasks.ts's getOpenBlockers), even when called
// from task-detail-sheet.tsx, which already has a
// `task.dependencies.blockedBy` array loaded in its own props. That
// array was fetched once, when the sheet opened — if a blocker completed
// in the meantime (another tab, another user), trusting the stale prop
// could produce a false negative (AS-281 says "no warning" only once
// blockers are ACTUALLY all complete; a guard whose whole purpose is a
// correctness gate must not trust a possibly-stale local copy over
// asking the server again). The extra round trip only happens at the
// moment of an actual attempt to complete a task, never per render/per
// row, so this does not violate the "no per-item network call"
// performance budget.
//
// Failure handling: if getOpenBlockers itself errors (network failure,
// server error), this fails OPEN — it resolves `true` (no dialog) rather
// than blocking the status change on a check that couldn't run. The
// mutation the caller then attempts (moveTaskStatus/moveAndReorderTask)
// remains the authoritative success/failure path with its own toast; a
// failed *blocker check* must never be confused with, or silently stand
// in for, a failed *status change*.
//
// UI: components/ui/alert-dialog.tsx (F119's shadcn/Base UI primitive,
// installed but unused until this feature) rather than a plain
// window.confirm (revoke-invite-button.tsx's own reason for choosing
// window.confirm — "no alert-dialog component installed yet" — no longer
// applies; F119 added one after that). AS-280 requires the confirmation
// to list WHICH blockers are open, by key and title — that needs real
// structured markup (a list), not a single confirm() string.

import { useCallback, useState } from "react";

import { getOpenBlockers } from "@/lib/actions/tasks";
import { isDoneStatus } from "@/lib/tasks/blocked-guard";
import { formatTaskKey } from "@/lib/tasks/task-key";
import type { DependencyRelatedTask } from "@/components/task/dependencies";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type PendingConfirmation = {
  blockers: DependencyRelatedTask[];
  resolve: (proceed: boolean) => void;
};

export function useBlockedDoneGuard() {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  // AS-280/AS-281: called by every status-change call site BEFORE it
  // calls its own mutation Server Action. Resolves `true` immediately
  // (no network call at all) for any target status other than "done" —
  // the common case for most status changes — so this guard costs
  // nothing on the vast majority of calls.
  const confirmIfMovingToDone = useCallback(
    async (
      taskId: string,
      nextStatus: string,
      // F222 (AS-410): the target column's CATEGORY, when the caller has
      // it (every real caller does — board.tsx/list-status-select.tsx/
      // task-detail-sheet.tsx all render from the project's real
      // `BoardColumnDef[]`, which carries `category`). Falls back to
      // isDoneStatus's own literal-`status`-text rule when omitted.
      nextStatusCategory?: string | null,
    ): Promise<boolean> => {
      if (!isDoneStatus(nextStatus, nextStatusCategory)) return true;

      const result = await getOpenBlockers(taskId);
      if (!result.ok) return true; // fail open — see doc comment above.
      if (result.data.length === 0) return true; // AS-281: no warning.

      return new Promise<boolean>((resolve) => {
        setPending({ blockers: result.data, resolve });
      });
    },
    [],
  );

  function settle(proceed: boolean) {
    setPending((current) => {
      current?.resolve(proceed);
      return null;
    });
  }

  const blockers = pending?.blockers ?? [];

  const dialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark as done anyway?</AlertDialogTitle>
          <AlertDialogDescription
            render={<div className="flex flex-col gap-2 text-left" />}
          >
            <p>
              This task is still blocked by{" "}
              {blockers.length === 1 ? "1 task" : `${blockers.length} tasks`}:
            </p>
            <ul className="list-disc pl-5">
              {blockers.map((blocker) => (
                <li key={blocker.dependencyId}>
                  <span className="font-medium text-foreground">
                    {formatTaskKey(blocker.projectKey, blocker.number) ??
                      blocker.title}
                  </span>{" "}
                  — {blocker.title}
                </li>
              ))}
            </ul>
            <p>You can still mark this task as done.</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>
            Mark as done anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmIfMovingToDone, dialog };
}
