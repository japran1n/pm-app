"use client";

// F136 (AS-244): the settings page's danger zone — moves the existing
// `deleteWorkspace` action (F021) behind a confirm dialog on the settings
// page. Owner-only visibility is a UI-only convenience gate: this
// component is only ever mounted by the settings page when the caller's
// own role is "owner" (see that page's `canDeleteWorkspace` check) — an
// admin never even receives this component in the render tree, matching
// AS-244's "only an owner sees the delete-workspace control" (not merely
// a disabled one). `deleteWorkspace` itself independently re-checks
// ownership server-side via `requireWorkspaceOwner`, so hiding this
// control is not the actual security boundary.
//
// Confirmation pattern: mirrors ArchiveProjectDialog (F029) — a Dialog
// with an explicit destructive confirm button — rather than
// RemoveMemberButton's plain `window.confirm`, because deleting an entire
// workspace is a heavier, less-reversible action than removing one
// member, and warrants surfacing the workspace name and consequence text
// in a real dialog.

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteWorkspace } from "@/lib/actions/workspaces";
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

export function DeleteWorkspaceDialog({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      // `deleteWorkspace` redirects on success (throws NEXT_REDIRECT,
      // matching F021's own behaviour), so any value returned here is
      // necessarily a failure — a resolved `{ ok: true }` never happens.
      const result = await deleteWorkspace(workspaceId);

      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="destructive">
            <Trash2 className="size-4" aria-hidden="true" />
            Delete workspace
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete workspace</DialogTitle>
          <DialogDescription>
            Deleting &quot;{workspaceName}&quot; removes it from every
            member&rsquo;s workspace switcher. This action cannot be undone
            from the UI.
          </DialogDescription>
        </DialogHeader>
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
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Deleting...
              </>
            ) : (
              "Delete workspace"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
