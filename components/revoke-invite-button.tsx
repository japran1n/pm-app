"use client";

// F018 (AS-024): smallest possible client boundary, same convention as
// InviteMemberForm — the members page (Server Component) renders
// everything else; this is only the interactive revoke control paired
// with the `revokeInvite` Server Action.
//
// Uses a plain `window.confirm` rather than pulling in shadcn's
// AlertDialog: this repo has no alert-dialog component installed yet
// (checked components/ui), and a native confirm is sufficient for a
// single destructive click with no extra form state.

import { useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { revokeInvite } from "@/lib/actions/workspaces";
import { Button } from "@/components/ui/button";

export function RevokeInviteButton({
  workspaceId,
  workspaceMemberId,
  invitedEmail,
}: {
  workspaceId: string;
  workspaceMemberId: string;
  invitedEmail: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const confirmed = window.confirm(
      `Revoke the invite for ${invitedEmail}?`,
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await revokeInvite(workspaceId, workspaceMemberId);
      if (result.ok) {
        toast.success(`Invite for ${invitedEmail} revoked.`);
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
      aria-label={`Revoke invite for ${invitedEmail}`}
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <X className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}
