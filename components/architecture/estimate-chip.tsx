"use client";

// Mission 20260918-architecture-enrichment, F17 (uses F16's
// DisciplineEstimatePopover): a small mono chip on a section card that
// shows the total estimated minutes across disciplines for that section's
// task, and opens the per-discipline breakdown/edit popover on click.
// Only rendered by SectionCard when `showDetails` is true (F17 scope) --
// the chip must add zero height/width to the card in the collapsed view.

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
}: {
  taskId: string;
  taskTitle: string;
  estimates: DisciplineEstimate[];
}) {
  const [open, setOpen] = useState(false);
  const total = estimates.reduce((sum, e) => sum + e.minutes, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={
              total > 0
                ? "h-5 rounded px-1.5 font-mono text-xs tabular-nums text-muted-foreground hover:text-foreground"
                : "h-5 rounded px-1.5 font-mono text-xs tabular-nums text-muted-foreground/0 hover:text-muted-foreground group-hover/card:text-muted-foreground/40"
            }
          >
            {total > 0 ? formatMinutes(total) : "+"}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-auto p-0">
        <DisciplineEstimatePopover
          taskId={taskId}
          taskTitle={taskTitle}
          estimates={estimates}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
