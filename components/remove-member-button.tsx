"use client";

// F020 (AS-016/AS-017/AS-018): owner/admin-only control to remove an
// active member. Same "smallest possible client boundary" convention as
// RevokeInviteButton/MemberRoleSelect — the members page (Server
// Component) renders everything else; this is only the interactive
// remove control paired with the `removeMember` Server Action.
//
// Visibility here is a UI-only convenience gate (the members page only
// renders this component when the caller is an owner/admin). The actual
// permission check — and the AS-018 sole-owner guard — lives server-side
// in `removeMember` itself, so hiding this control is not the security
// boundary.

import { useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { removeMember } from "@/lib/actions/workspaces";
import { Button } from "@/components/ui/button";

export function RemoveMemberButton({
  workspaceId,
  workspaceMemberId,
  memberLabel,
}: {
  workspaceId: string;
  workspaceMemberId: string;
  memberLabel: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const confirmed = window.confirm(
      `Remove ${memberLabel} from this workspace?`,
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await removeMember(workspaceId, workspaceMemberId);
      if (result.ok) {
        toast.success(`${memberLabel} removed from the workspace.`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={isPending}
      onClick={handleClick}
      aria-label={`Remove ${memberLabel}`}
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <X className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}
