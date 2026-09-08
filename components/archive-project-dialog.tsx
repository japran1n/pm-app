"use client";

// F029 (AS-030, AS-031, AS-033): archive affordance for a project, added to
// the project list page's card (F027) alongside EditProjectDialog. Only
// rendered when the caller's own membership role is admin/owner (the page
// passes `canArchive` down) — AS-033 requires the action be "unavailable in
// the UI" for a plain member, not just rejected server-side, so this
// component isn't even mounted for a member. The server-side re-check in
// `archiveProject` (lib/actions/projects.ts) is the actual enforcement
// boundary; this UI gate is defense in depth's other half.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { archiveProject } from "@/lib/actions/projects";
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

export function ArchiveProjectDialog({
  workspaceId,
  project,
}: {
  workspaceId: string;
  project: { id: string; name: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      const result = await archiveProject(project.id, workspaceId);

      if (result.ok) {
        toast.success(`${project.name} archived.`);
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label={`Archive ${project.name}`}
          >
            <Archive className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive Project</DialogTitle>
          <DialogDescription>
            Archiving &quot;{project.name}&quot; hides it from the default
            project list. It is not deleted — its data, including any
            tasks, remains intact.
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
            onClick={handleArchive}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Archiving...
              </>
            ) : (
              "Archive"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
