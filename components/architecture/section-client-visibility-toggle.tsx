"use client";

// F003 (missions/20260914-portal-simplify, AS-004, AS-005): "share this
// section with the client" control on an Architecture board section card.
// Same optimistic flip/rollback convention as
// components/task/client-visibility-toggle.tsx and this feature's sibling
// PageClientVisibilityToggle -- no confirmation dialog here, since a
// single section (unlike a page) has no children of its own to ask about.

import { useState, useTransition } from "react";
import { Eye, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { setSectionClientVisibility } from "@/lib/actions/architecture";
import { Button } from "@/components/ui/button";
import type { BoardSection } from "@/lib/queries/architecture";

export function SectionClientVisibilityToggle({ section }: { section: BoardSection }) {
  const serverValue = section.clientVisible ?? false;
  const [isShared, setIsShared] = useState(serverValue);
  const [isPending, startTransition] = useTransition();

  const [syncedSectionId, setSyncedSectionId] = useState(section.id);
  const [lastServerValue, setLastServerValue] = useState(serverValue);

  if (syncedSectionId !== section.id) {
    setSyncedSectionId(section.id);
    setLastServerValue(serverValue);
    setIsShared(serverValue);
  } else if (lastServerValue !== serverValue) {
    setLastServerValue(serverValue);
    setIsShared(serverValue);
  }

  function handleToggle() {
    const next = !isShared;
    setIsShared(next);

    startTransition(async () => {
      const result = await setSectionClientVisibility(section.id, next);

      if (!result.ok) {
        setIsShared(!next);
        toast.error(result.error);
        return;
      }

      toast.success(next ? "Shared with the client." : "Hidden from the client.");
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      disabled={isPending}
      aria-pressed={isShared}
      aria-label={isShared ? "Hide section from client" : "Share section with client"}
      title={isShared ? "Visible to client" : "Internal only"}
      className={isShared ? "shrink-0 text-emerald-600" : "shrink-0 text-muted-foreground"}
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : isShared ? (
        <Eye className="size-4" aria-hidden="true" />
      ) : (
        <Lock className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}
