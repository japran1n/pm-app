"use client";

// F130 (AS-233, AS-234): lets the current workspace owner hand off
// ownership to another active member. Confirmation pattern mirrors
// DeleteWorkspaceDialog (F136) — a real Dialog with explicit destructive
// confirm button, not RemoveMemberButton's plain `window.confirm` —
// because transferring ownership is a heavier, less-reversible-by-the-
// caller action (the caller immediately loses owner-only capabilities such
// as deleting the workspace) than removing a member, and warrants naming
// the chosen member and spelling out the caller's own demotion explicitly.
//
// Visibility here is a UI-only convenience gate: the members settings page
// only mounts this component when the caller's own role is "owner" (see
// that page's `canDeleteWorkspace`-style check) — an admin never even
// receives this component in the render tree. `transferOwnership` itself
// independently re-checks ownership server-side via
// `requireWorkspaceOwner`, so hiding this control is not the actual
// security boundary.
//
// AS-234: the picker is built only from active (non-pending) members,
// excluding the caller themselves — a pending/invited row or a removed
// member is never offered as a choice here in the first place (the server
// independently rejects both if this control were ever bypassed).

import { useState, useTransition } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { transferOwnership } from "@/lib/actions/workspaces";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TransferOwnershipCandidate = {
  userId: string;
  label: string;
};

export function TransferOwnershipDialog({
  workspaceId,
  candidates,
}: {
  workspaceId: string;
  candidates: TransferOwnershipCandidate[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedCandidate = candidates.find(
    (candidate) => candidate.userId === selectedUserId,
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSelectedUserId(null);
      setError(null);
    }
  }

  function handleTransfer() {
    if (!selectedUserId) return;
    setError(null);
    startTransition(async () => {
      const result = await transferOwnership(workspaceId, selectedUserId);
      if (result.ok) {
        toast.success(
          `${selectedCandidate?.label ?? "The selected member"} is now the workspace owner.`,
        );
        setOpen(false);
        setSelectedUserId(null);
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  // No active members other than the caller themselves to transfer to —
  // render nothing rather than a dialog with an empty, unusable picker.
  if (candidates.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline">
            <ArrowRightLeft className="size-4" aria-hidden="true" />
            Transfer ownership
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>
            Choose a member to become the new owner of this workspace. You
            will be demoted to admin immediately — you will keep access to
            manage members and settings, but you will no longer be able to
            delete the workspace or transfer ownership again yourself.
          </DialogDescription>
        </DialogHeader>

        <Select
          value={selectedUserId ?? undefined}
          onValueChange={(value) => setSelectedUserId(value)}
          disabled={isPending}
        >
          <SelectTrigger aria-label="New owner">
            <SelectValue placeholder="Select a member" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.userId} value={candidate.userId}>
                {candidate.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedCandidate && (
          <p className="text-mini text-muted-foreground">
            &quot;{selectedCandidate.label}&quot; will become the owner, and
            you will become an admin.
          </p>
        )}

        {error && (
          <p role="alert" className="text-mini text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="ghost" disabled={isPending}>
                Cancel
              </Button>
            }
          />
          <Button
            type="button"
            variant="destructive"
            disabled={isPending || !selectedUserId}
            onClick={handleTransfer}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Transferring...
              </>
            ) : (
              "Transfer ownership"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
