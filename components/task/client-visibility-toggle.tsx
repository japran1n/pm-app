"use client";

// C2 team-side control: "share this with the client".
//
// Optimistic with rollback, matching the sibling Watchers toggle's
// convention exactly (flip local state, call the action, roll back and
// toast on failure) — a share toggle that lags behind the click invites a
// double-click, and a double-click on this particular control means
// accidentally publishing internal work to an outside party.
//
// Rendered only when the workspace actually has a client. A permanent
// "Share with client" affordance on every task in every workspace would be
// noise for the majority of teams who never use the portal, and worse, it
// would imply an audience that does not exist.

import { useState, useTransition } from "react";
import { Eye, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { setTaskClientVisibility } from "@/lib/actions/client-visibility";
import { Button } from "@/components/ui/button";

export function ClientVisibilityToggle({
  taskId,
  clientVisible,
  disabled = false,
}: {
  taskId: string;
  clientVisible: boolean;
  disabled?: boolean;
}) {
  const [isShared, setIsShared] = useState(clientVisible);
  const [isPending, startTransition] = useTransition();

  // Both re-syncs are done during render rather than in an effect, per
  // this codebase's existing convention for optimistic mirrors (see
  // Watchers' syncedTaskId) — and because a setState inside an effect is
  // a lint error here, correctly so: it renders once with stale state and
  // then immediately again.
  //
  // Two separate triggers, because they answer different questions:
  //   - the sheet switched to a different task, so whatever local state
  //     the previous task left behind is meaningless;
  //   - the server sent a new value for the SAME task (this action
  //     revalidates, so a change made in another tab or by a bulk action
  //     should win over this component's optimistic copy).
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [lastServerValue, setLastServerValue] = useState(clientVisible);

  if (syncedTaskId !== taskId) {
    setSyncedTaskId(taskId);
    setLastServerValue(clientVisible);
    setIsShared(clientVisible);
  } else if (lastServerValue !== clientVisible) {
    setLastServerValue(clientVisible);
    setIsShared(clientVisible);
  }

  const handleToggle = () => {
    const next = !isShared;
    setIsShared(next);

    startTransition(async () => {
      const result = await setTaskClientVisibility(taskId, next);

      if (!result.ok) {
        setIsShared(!next);
        toast.error(result.error);
        return;
      }

      toast.success(
        next ? "Shared with the client." : "Hidden from the client.",
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
      aria-pressed={isShared}
      className={isShared ? "text-emerald-600 dark:text-emerald-400" : undefined}
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : isShared ? (
        <Eye className="size-4" aria-hidden="true" />
      ) : (
        <Lock className="size-4" aria-hidden="true" />
      )}
      {isShared ? "Visible to client" : "Internal only"}
    </Button>
  );
}
