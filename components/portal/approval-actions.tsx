"use client";

// F4 (docs/client-dashboard-features-plan.md): the client's response to a
// task the team flagged as waiting on them. Two paths, not a single
// accept/reject toggle — Approve needs no further input, Request changes
// always needs the actual note or the team gets a status flip with no
// context, which is the exact "ok, approved" comment friction this feature
// exists to remove.
//
// F005: both actions apply optimistically — the UI flips to its "done"
// state synchronously, before the server round trip resolves (AS-012).
// `approvePortalTask` / `requestPortalTaskChanges` can resolve `{ ok: false
// }` OR throw (network loss, serialization) — both paths revert the
// optimistic state and show a toast (AS-013, AS-014). A ref (not
// `isPending` alone) guards in-flight calls: `isPending` only flips after
// React commits the transition, which lags a synchronous second click, so
// only the ref reliably blocks a same-tick double click (AS-015, AS-016).
//
// This doesn't reuse `lib/hooks/use-optimistic-action.ts` — that hook's
// contract is a single `T`-valued optimistic field reverted automatically
// by `useOptimistic` falling back to `current` once the transition
// settles. Here there are two independent optimistic outcomes (approved /
// sent) layered under a second piece of UI state (the request-changes
// form open/closed, with its message draft) that must NOT reset on
// failure. Widening the shared hook to carry that would break its other
// callers, so this component follows the same shape (ref guard + optimistic
// apply + manual revert + toast) by hand instead.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";

import {
  approvePortalTask,
  requestPortalTaskChanges,
} from "@/lib/actions/portal-approval";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export function PortalApprovalActions({ taskId }: { taskId: string }) {
  const [isRequestingChanges, setIsRequestingChanges] = useState(false);
  const [message, setMessage] = useState("");
  const [optimisticApproved, setOptimisticApproved] = useState(false);
  const [optimisticSent, setOptimisticSent] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Synchronous in-flight guard. `isPending` is only set once React has
  // committed the transition start, which is too late to stop a second
  // click dispatched in the same tick as the first — this ref is set the
  // instant the handler runs and cleared only once the action settles.
  const inFlightRef = useRef(false);

  const handleApprove = () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    // Applied before the `await` below — the approved state renders
    // immediately, without waiting for the server round trip (AS-012).
    setOptimisticApproved(true);

    startTransition(async () => {
      try {
        const result = await approvePortalTask(taskId);

        if (!result.ok) {
          setOptimisticApproved(false);
          toast.error(result.error);
          return;
        }

        toast.success("Approved.");
        router.refresh();
      } catch {
        setOptimisticApproved(false);
        toast.error(GENERIC_ERROR);
      } finally {
        inFlightRef.current = false;
      }
    });
  };

  const handleRequestChanges = () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (inFlightRef.current) return;
    inFlightRef.current = true;

    // Same optimistic-before-await ordering as approve, but the form's
    // open/closed and draft-message state is left alone here so a revert
    // can restore the exact note the client typed (AS-013/AS-014), rather
    // than dropping it back to blank.
    setOptimisticSent(true);

    startTransition(async () => {
      try {
        const result = await requestPortalTaskChanges(taskId, trimmed);

        if (!result.ok) {
          setOptimisticSent(false);
          toast.error(result.error);
          return;
        }

        toast.success("Sent — the team will follow up.");
        setMessage("");
        setIsRequestingChanges(false);
        router.refresh();
      } catch {
        setOptimisticSent(false);
        toast.error(GENERIC_ERROR);
      } finally {
        inFlightRef.current = false;
      }
    });
  };

  if (optimisticApproved) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-4 text-mini font-medium">
        <Check className="size-4 text-emerald-600" aria-hidden="true" />
        Approved.
      </div>
    );
  }

  if (optimisticSent) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-600/30 bg-amber-600/5 p-4 text-mini font-medium">
        <MessageSquareWarning className="size-4" aria-hidden="true" />
        Sent — the team will follow up.
      </div>
    );
  }

  if (isRequestingChanges) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-amber-600/30 bg-amber-600/5 p-4">
        <p className="text-mini font-medium">What needs to change?</p>
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Describe what you'd like changed…"
          disabled={isPending}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => {
              setIsRequestingChanges(false);
              setMessage("");
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isPending || !message.trim()}
            onClick={handleRequestChanges}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Send
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-600/30 bg-amber-600/5 p-4">
      <p className="text-mini font-medium">This is waiting on your review.</p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={handleApprove}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
          Approve
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setIsRequestingChanges(true)}
        >
          <MessageSquareWarning className="size-4" aria-hidden="true" />
          Request changes
        </Button>
      </div>
    </div>
  );
}
