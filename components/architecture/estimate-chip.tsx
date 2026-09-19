"use client";

// Mission 20260918-architecture-enrichment, F17 (uses F16's
// DisciplineEstimatePopover): a small mono chip on a PAGE card header that
// shows the total estimated minutes across disciplines for that page's
// task, and opens the per-discipline breakdown/edit popover on click.
// Estimates are page-level only; sections carry none. Only rendered when
// `showDetails` is on.

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { DisciplineEstimatePopover } from "@/components/architecture/discipline-estimate-popover";
import type { DisciplineEstimate } from "@/lib/architecture/types";

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function EstimateChip({
  taskId,
  taskTitle,
  estimates,
  loading,
  onDetailsInvalidate,
}: {
  taskId: string;
  taskTitle: string;
  estimates: DisciplineEstimate[];
  /**
   * F084: true while the lazily-fetched details cache (owned by
   * ArchitectureViewToggle) hasn't resolved yet. `estimates` reads as `[]`
   * during that window too, so the chip must stay non-interactive instead
   * of looking like a confirmed "no estimate" state -- opening the popover
   * and saving in that window would wipe every real estimate/note
   * (setDisciplineEstimatesBulk treats an empty input as "clear").
   */
  loading?: boolean;
  /**
   * Called after a successful save so the owner of the lazily-fetched
   * details cache (ArchitectureViewToggle) can drop it and refetch --
   * router.refresh() alone only re-renders server components.
   */
  onDetailsInvalidate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const total = estimates.reduce((sum, e) => sum + e.minutes, 0);

  return (
    <Popover open={loading ? false : open} onOpenChange={loading ? undefined : setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            aria-label={`Estimate for ${taskTitle}`}
            aria-busy={loading || undefined}
            className={
              total > 0
                ? "h-6 rounded-md px-1.5 font-mono text-xs tabular-nums text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                : "h-6 rounded-md px-1.5 font-mono text-xs tabular-nums text-muted-foreground/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            }
          >
            {loading ? "…" : total > 0 ? formatMinutes(total) : "+ estimate"}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-auto p-0">
        <DisciplineEstimatePopover
          taskId={taskId}
          taskTitle={taskTitle}
          estimates={estimates}
          onSaved={onDetailsInvalidate}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
