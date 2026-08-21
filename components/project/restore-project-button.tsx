"use client";

// F143 (AS-252, AS-253, AS-255): restore affordance for an archived
// project, rendered on the archive page (app/(workspace)/w/[workspaceSlug]/
// archive/page.tsx) alongside each archived project's card. Only rendered
// when the caller's own membership role is admin/owner (the page passes
// `canRestore` down, computed the same way the project list page computes
// `canArchive` for ArchiveProjectDialog) — AS-253 requires the action be
// unavailable in the UI for a non-admin, not just rejected server-side.
// The server-side re-check in `restoreProject`
// (lib/actions/projects.ts) is the actual enforcement boundary; this UI
// gate is defense in depth's other half.
//
// No confirmation dialog: unlike archiving (which hides a project from the
// active list and warrants a confirm step), restoring is the corrective,
// non-destructive action — it undoes an archive, and archiving itself
// remains available immediately after if this were a mistake. A single
// button with a loading state + toast feedback mirrors this codebase's
// lighter-weight action affordances (no dialog needed for a reversible
// operation).

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { restoreProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";

export function RestoreProjectButton({
  workspaceId,
  project,
}: {
  workspaceId: string;
  project: { id: string; name: string };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRestore() {
    startTransition(async () => {
      const result = await restoreProject(project.id, workspaceId);

      if (result.ok) {
        toast.success(`${project.name} restored.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={handleRestore}
      aria-label={`Restore ${project.name}`}
    >
      {isPending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Restoring...
        </>
      ) : (
        <>
          <ArchiveRestore className="size-4" aria-hidden="true" />
          Restore
        </>
      )}
    </Button>
  );
}
