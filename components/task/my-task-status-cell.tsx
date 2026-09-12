"use client";

// F231 (AS-438): inline status-change control for a row on the My Tasks
// page. Thin wrapper around <ListStatusSelect> (F057), which already
// calls the REAL `moveTaskStatus` Server Action (lib/actions/tasks.ts,
// F045) -- that action re-checks workspace membership, `canWrite` role,
// and (F322/F323) `isProjectVisibleToCaller` against the TASK'S OWN
// project server-side, so a task in a project the caller can no longer
// write to (or see) is rejected there even if it somehow rendered here.
// No parallel status-change action was written for this feature, per the
// "reuse existing Server Actions" instruction.
//
// `statusOptions` is passed down already resolved for this row's own
// project (My Tasks page batches one project_statuses query across every
// distinct project id present in the result, never a query per row) --
// this component itself makes no extra network call.

import { ListStatusSelect } from "@/components/task/list-status-select";
import type { TaskCardTask } from "@/components/task/task-card";
import type { MyTaskStatusOption } from "@/app/(workspace)/w/[workspaceSlug]/my-tasks/page";

export function MyTaskStatusCell({
  taskId,
  status,
  statusOptions,
}: {
  taskId: string;
  status: TaskCardTask["status"];
  statusOptions?: MyTaskStatusOption[];
}) {
  return (
    <ListStatusSelect
      taskId={taskId}
      status={status}
      statusOptions={
        statusOptions && statusOptions.length > 0
          ? (statusOptions as unknown as {
              value: TaskCardTask["status"];
              label: string;
              color: string;
              category?: string | null;
              displayGroup?: string | null;
            }[])
          : undefined
      }
    />
  );
}
