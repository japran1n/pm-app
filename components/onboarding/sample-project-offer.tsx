"use client";

// F254 (AS-494): the UI half of "a brand-new workspace offers to create a
// sample project" — offered, never forced, right where a real user would
// naturally land first: the workspace dashboard's existing zero-tasks empty
// state (components/dashboard/dashboard-content.tsx, F074's `isEmpty`
// branch). Reusing that existing "this workspace has zero tasks" signal
// rather than adding a second "is this workspace brand-new" flag/query-param
// is the clarified spec's "simpler option, no new dependency" choice — an
// empty workspace is exactly the moment this offer is useful, whether it's
// five minutes or five weeks old.
//
// Pattern mirrors DeleteWorkspaceDialog's own action-call shape: plain
// `useTransition` (not `useActionState`, since this action takes no
// FormData/prevState — it's a single `workspaceId` argument), sonner toast
// on failure with the control returning to an actionable state (this
// feature's clarified "Failure handling" answer), `router.refresh()` on
// success so the dashboard's server-fetched task counts pick up the new
// tasks without a manual reload.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { createSampleProject } from "@/lib/seed/sample-project";
import { Button } from "@/components/ui/button";

export function SampleProjectOffer({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  function handleCreate() {
    startTransition(async () => {
      const result = await createSampleProject(workspaceId);

      if (!result.ok) {
        // Failure handling per this feature's clarified spec: no optimistic
        // change to revert (nothing rendered speculatively), a plain-
        // language toast, and the button returns to an actionable state
        // (isPending flips back to false once this transition settles).
        toast.error(result.error);
        return;
      }

      toast.success(
        `${result.data.projectName} created with ${result.data.tasksCreated} sample tasks.`,
      );
      router.push(`/w/${workspaceSlug}/projects/${result.data.projectId}/list`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-4">
      <p className="text-sm font-medium">Not sure where to start?</p>
      <p className="text-sm text-muted-foreground">
        Create a sample project with a few tasks across every column —
        priorities, due dates, a checklist, and a comment included. It&apos;s
        clearly labelled as a sample, and you can delete it any time from the
        project&apos;s Archive control.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={handleCreate}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Creating sample project...
            </>
          ) : (
            <>
              <Sparkles className="size-4" aria-hidden="true" />
              Create sample project
            </>
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => setDismissed(true)}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
