"use client";

// F1 (docs/client-dashboard-features-plan.md): "ask the client for a
// decision on this task". Sibling of ClientVisibilityToggle, same
// optimistic-with-rollback shape — copied deliberately rather than
// factored into a shared generic toggle, because the two controls answer
// different questions ("can they see it" vs "do they need to act on it")
// and a shared abstraction would blur that in the sheet's UI.

import { useState, useTransition } from "react";
import { Loader2, CircleDot, CircleCheck } from "lucide-react";
import { toast } from "sonner";

import { setPendingClientApproval } from "@/lib/actions/client-visibility";
import { Button } from "@/components/ui/button";

export function PendingApprovalToggle({
  taskId,
  pendingClientApproval,
  disabled = false,
}: {
  taskId: string;
  pendingClientApproval: boolean;
  disabled?: boolean;
}) {
  const [isPendingApproval, setIsPendingApproval] = useState(
    pendingClientApproval,
  );
  const [isPending, startTransition] = useTransition();

  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [lastServerValue, setLastServerValue] = useState(
    pendingClientApproval,
  );

  if (syncedTaskId !== taskId) {
    setSyncedTaskId(taskId);
    setLastServerValue(pendingClientApproval);
    setIsPendingApproval(pendingClientApproval);
  } else if (lastServerValue !== pendingClientApproval) {
    setLastServerValue(pendingClientApproval);
    setIsPendingApproval(pendingClientApproval);
  }

  const handleToggle = () => {
    const next = !isPendingApproval;
    setIsPendingApproval(next);

    startTransition(async () => {
      const result = await setPendingClientApproval(taskId, next);

      if (!result.ok) {
        setIsPendingApproval(!next);
        toast.error(result.error);
        return;
      }

      toast.success(
        next
          ? "Marked as waiting on the client."
          : "No longer waiting on the client.",
      );
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      disabled={disabled || isPending}
      aria-pressed={isPendingApproval}
      className={
        isPendingApproval ? "text-amber-600 dark:text-amber-400" : undefined
      }
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : isPendingApproval ? (
        <CircleDot className="size-4" aria-hidden="true" />
      ) : (
        <CircleCheck className="size-4" aria-hidden="true" />
      )}
      {isPendingApproval ? "Waiting on client approval" : "Ask client to approve"}
    </Button>
  );
}
