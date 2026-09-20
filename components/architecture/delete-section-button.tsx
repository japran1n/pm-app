"use client";

// Mission 20260910-182104, F017 (AS-035): lets a team member delete a
// section from the Architecture board. Confirmation pattern mirrors
// DeletePageButton (components/architecture/delete-page-button.tsx) and
// DeleteQuestionButton (components/brief/delete-question-button.tsx) -- a
// Dialog with an explicit destructive confirm button rather than a plain
// window.confirm, since this action is permanent.

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useArchitectureActions } from "@/lib/architecture/actions-context";
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

export function DeleteSectionButton({
  sectionId,
  sectionTitle,
}: {
  sectionId: string;
  sectionTitle?: string;
}) {
  const { deleteSection, readOnly } = useArchitectureActions();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteSection(sectionId);

      if (!result.success) {
        const message = result.error ?? "Something went wrong.";
        setError(message);
        toast.error(message);
        return;
      }

      setOpen(false);
      router.refresh();
    });
  }

  if (readOnly) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={
              sectionTitle ? `Delete ${sectionTitle}` : "Delete section"
            }
            className="shrink-0"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this section?</DialogTitle>
          <DialogDescription>
            Delete this section? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
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
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Deleting...
              </>
            ) : (
              "Delete section"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
