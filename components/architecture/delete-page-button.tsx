"use client";

// Mission 20260910-182104, F018 (AS-008, AS-036): lets a team member
// delete a page (and its sections, via cascade_delete_task -- see
// lib/actions/architecture.ts's deletePage) from the Architecture board.
// Confirmation pattern mirrors DeleteQuestionButton
// (components/brief/delete-question-button.tsx) -- a Dialog with an
// explicit destructive confirm button, rather than a plain
// window.confirm, since this action is permanent and destroys every
// section on the page, not just the page's own row.

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deletePage } from "@/lib/actions/architecture";
import type { BoardPage } from "@/lib/queries/architecture";
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

export function DeletePageButton({ page }: { page: BoardPage }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deletePage(page.id);

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Delete ${page.title}`}
            className="shrink-0"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this page?</DialogTitle>
          <DialogDescription>
            Delete this page and all its sections? This cannot be undone.
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
              "Delete page"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
