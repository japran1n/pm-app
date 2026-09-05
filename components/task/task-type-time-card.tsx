// F118 (AS-068): the smallest possible surface for
// rpc_project_time_totals (F116) — one compact card, type name, tracked
// hours, estimated hours. No chart, no trend line, no filtering UI, per
// this feature's own spec. Deliberately a plain Server Component (no
// "use client"): the data is read once per page render, nothing here is
// interactive.

import { formatDuration } from "@/lib/time/format-duration";
import type { ProjectTaskTypeTimeTotal } from "@/lib/queries/task-type-time-totals";

export function TaskTypeTimeCard({
  totals,
}: {
  totals: ProjectTaskTypeTimeTotal[];
}) {
  if (totals.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Time by task type</h2>
        <p className="text-xs text-muted-foreground">
          Tracked and estimated hours grouped by task type.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {totals.map((total) => (
          <div
            key={total.taskTypeId}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span className="truncate">{total.taskTypeName}</span>
            <span className="shrink-0 text-muted-foreground">
              {formatDuration(total.trackedMinutes)} tracked &middot;{" "}
              {formatDuration(total.estimatedMinutes)} estimated
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
