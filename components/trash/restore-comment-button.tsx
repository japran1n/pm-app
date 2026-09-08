"use client";

// F191 (AS-346): the trash page's restore control for a deleted comment.
// Deliberately a small, self-contained Client Component (not folded into
// the parent `TrashList` Server Component) — the same "smallest possible
// client boundary" convention this codebase already applies to realtime
// hooks (see components/task/use-comments-realtime.ts's doc comment): a
// single interactive control shouldn't force its whole parent list to
// become a client bundle.
//
// Kept intentionally separate from any task-restore control (F189, a
// different concurrently-run feature scoped to lib/actions/tasks.ts) so
// the two features' UI wiring don't collide inside the same component —
// this file only ever calls `restoreComment`.

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { restoreComment } from "@/lib/actions/comments";

export function RestoreCommentButton({ commentId }: { commentId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  if (restored) {
    return (
      <span className="text-micro text-muted-foreground">Restored</span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await restoreComment(commentId);
            if (result.ok) {
              setRestored(true);
            } else {
              setError(result.error);
            }
          });
        }}
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Restore
      </Button>
      {error && (
        <span role="alert" className="text-micro text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
