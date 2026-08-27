"use client";

// F4 (docs/client-dashboard-features-plan.md): the client's response to a
// task the team flagged as waiting on them. Two paths, not a single
// accept/reject toggle — Approve needs no further input, Request changes
// always needs the actual note or the team gets a status flip with no
// context, which is the exact "ok, approved" comment friction this feature
// exists to remove.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";

import {
  approvePortalTask,
  requestPortalTaskChanges,
} from "@/lib/actions/portal-approval";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function PortalApprovalActions({ taskId }: { taskId: string }) {
  const [isRequestingChanges, setIsRequestingChanges] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleApprove = () => {
    startTransition(async () => {
      const result = await approvePortalTask(taskId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Approved.");
      router.refresh();
    });
  };

  const handleRequestChanges = () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const result = await requestPortalTaskChanges(taskId, trimmed);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Sent — the team will follow up.");
      setMessage("");
      setIsRequestingChanges(false);
      router.refresh();
    });
  };

  if (isRequestingChanges) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-amber-600/30 bg-amber-600/5 p-4">
        <p className="text-sm font-medium">What needs to change?</p>
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
      <p className="text-sm font-medium">This is waiting on your review.</p>
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
