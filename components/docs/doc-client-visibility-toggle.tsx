"use client";

// F022 (missions/20260903-portal, AS-051): the doc header's "share this
// with the client" control — the doc-system counterpart of
// components/task/client-visibility-toggle.tsx, copied deliberately close
// to that component's own shape per this feature's own instruction ("the
// doc toggle behaves like the task one"): optimistic with rollback,
// same re-sync-on-prop-change convention, same icon/label pair.
//
// Rendered only for a project-scoped doc — `docs.client_visible` only
// ever reaches a client through `docs_select_client`
// (20261014010000), which requires `project_id is not null` (a client's
// portal is always scoped to one project). A workspace-level doc has no
// client audience to share with.

import { useState, useTransition } from "react";
import { Eye, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { setDocClientVisibility } from "@/lib/actions/docs";
import { Button } from "@/components/ui/button";

export function DocClientVisibilityToggle({
  docId,
  clientVisible,
  disabled = false,
}: {
  docId: string;
  clientVisible: boolean;
  disabled?: boolean;
}) {
  const [isShared, setIsShared] = useState(clientVisible);
  const [isPending, startTransition] = useTransition();

  const [syncedDocId, setSyncedDocId] = useState(docId);
  const [lastServerValue, setLastServerValue] = useState(clientVisible);

  if (syncedDocId !== docId) {
    setSyncedDocId(docId);
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
      const result = await setDocClientVisibility(docId, next);

      if (!result.ok) {
        setIsShared(!next);
        toast.error(result.error);
        return;
      }

      toast.success(next ? "Shared with the client." : "Hidden from the client.");
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
