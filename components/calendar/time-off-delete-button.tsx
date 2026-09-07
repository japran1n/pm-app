// Team PTO calendar: the small "x" that deletes one's own (or, per RLS, an
// admin's) PTO entry directly from the calendar strip. Kept as its own
// tiny Client Component (not inlined into time-off-day-strip.tsx) so that
// file stays a plain Server Component, matching week-time-grid.tsx's own
// "interactive leaf, static parent" split.

"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";

import { deleteTimeOff } from "@/lib/actions/time-off";

export function TimeOffDeleteButton({ entryId }: { entryId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      type="button"
      aria-label="Remove time off"
      data-testid="time-off-delete-button"
      title={error ?? "Remove"}
      disabled={isPending}
      className="ml-auto shrink-0 rounded text-amber-900/60 hover:text-amber-900 disabled:opacity-50"
      onClick={(event) => {
        event.stopPropagation();
        startTransition(async () => {
          const result = await deleteTimeOff({ entryId });
          if (!result.ok) {
            // Expected/benign: a non-owner, non-admin caller's RLS-backed
            // rejection -- surfaced as a title tooltip rather than a
            // blocking dialog, since this button renders for every PTO
            // entry regardless of caller permission (no per-caller
            // ownership prop is threaded down to this Server-rendered
            // strip today).
            setError(result.error);
            return;
          }
          // No separate router.refresh() -- deleteTimeOff's own
          // `revalidatePath` call, combined with this transition, is
          // enough for Next.js to refresh the Router Cache (same
          // reasoning as add-time-off-dialog.tsx's own comment).
        });
      }}
    >
      <X className="size-3" aria-hidden="true" />
    </button>
  );
}
