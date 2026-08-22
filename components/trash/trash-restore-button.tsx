"use client";

// F189 (AS-344, AS-351): the one interactive control this feature adds to
// the otherwise read-only trash view (F188) — restores a single deleted
// task. Client Component per the existing `TrashFilters` precedent (a
// Server Component page composing small Client Component islands for the
// bits that need interaction), so `TrashList`/`TrashPage` stay pure
// Server Components apart from this one button.
//
// Comment rows never render this control (there is no `restoreComment`
// action — out of scope for this feature, see the handoff), only task
// rows do.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { restoreTask } from "@/lib/actions/tasks";

export function TrashRestoreButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDone, setIsDone] = useState(false);

  const handleRestore = () => {
    startTransition(async () => {
      const result = await restoreTask(taskId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setIsDone(true);
      toast.success(
        result.data.statusWasReset
          ? "Task restored. Its original status no longer exists, so it was reset to the first column."
          : "Task restored.",
      );
      // Refresh so the row disappears from this trash listing (the task
      // is live again, so getWorkspaceTrash's `deleted_at is not null`
      // filter no longer matches it).
      router.refresh();
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending || isDone}
      onClick={handleRestore}
    >
      {isPending ? "Restoring…" : isDone ? "Restored" : "Restore"}
    </Button>
  );
}
