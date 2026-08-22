"use client";

// F192 (AS-348, AS-349): the typed-confirmation dialog gating permanent
// purge from the trash view. Client Component, same "Server Component page
// composing small Client Component islands for the bits that need
// interaction" precedent as TrashFilters/TrashRestoreButton (F188/F189).
//
// Only rendered for a workspace owner (see trash-list.tsx) — a non-owner
// never sees this control at all, though the real enforcement boundary is
// `purgeTrashItem`'s own server-side `canPurge` re-check
// (lib/actions/purge.ts), not this component's visibility.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  purgeTrashItem,
  PURGE_CONFIRMATION_PHRASE,
} from "@/lib/actions/purge";

export function PurgeDialog({
  itemId,
  itemType,
  itemLabel,
}: {
  itemId: string;
  itemType: "task" | "comment";
  itemLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [isPending, startTransition] = useTransition();

  const canConfirm = confirmation === PURGE_CONFIRMATION_PHRASE;

  const handlePurge = () => {
    if (!canConfirm) return;
    startTransition(async () => {
      const result = await purgeTrashItem(itemId, itemType, confirmation);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Permanently deleted.");
      setOpen(false);
      setConfirmation("");
      // The purged item no longer exists — refresh so it disappears from
      // this trash listing (AS-349).
      router.refresh();
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setConfirmation("");
      }}
    >
      <AlertDialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <Trash2 className="size-4" />
            Delete permanently
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes &ldquo;{itemLabel}&rdquo; and cannot be
            undone. Type {PURGE_CONFIRMATION_PHRASE} to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          autoFocus
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={PURGE_CONFIRMATION_PHRASE}
          aria-label={`Type ${PURGE_CONFIRMATION_PHRASE} to confirm`}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm || isPending}
            onClick={handlePurge}
          >
            {isPending ? "Deleting…" : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
