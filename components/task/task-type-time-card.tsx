// F118 (AS-068): the smallest possible surface for
// rpc_project_time_totals (F116) — one compact card, type name, tracked
// hours, estimated hours. No chart, no trend line, no filtering UI, per
// this feature's own spec. Deliberately a plain Server Component (no
// "use client"): the data is read once per page render, nothing here is
// interactive.

import { formatDuration } from "@/lib/time/format-duration";
import type { ProjectTaskTypeTimeTotal } from "@/lib/queries/task-type-time-totals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Visual redesign (internal Hours tab, "make it clearer/cleaner"): same
// markup shape as before (still a plain Server Component, no chart, no
// filtering UI, per this feature's own spec) but on the shared `Card`
// primitive with a visible row divider, matching `TeamHoursView`'s own
// redesign below it on the same page.
export function TaskTypeTimeCard({
  totals,
}: {
  totals: ProjectTaskTypeTimeTotal[];
}) {
  if (totals.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time by task type</CardTitle>
        <p className="text-micro text-muted-foreground">
          Tracked and estimated hours grouped by task type.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <div className="flex flex-col divide-y divide-border/60 border-t border-border/60">
          {totals.map((total) => (
            <div
              key={total.taskTypeId}
              className="flex items-center justify-between gap-4 px-4 py-2.5 text-mini"
            >
              <span className="truncate font-medium">{total.taskTypeName}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatDuration(total.trackedMinutes)} tracked &middot;{" "}
                {formatDuration(total.estimatedMinutes)} estimated
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
