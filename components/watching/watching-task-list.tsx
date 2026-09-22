import Link from "next/link";
import { Eye } from "lucide-react";

import type { WatchedTaskListItem } from "@/lib/queries/watching";
import { StatusBadge } from "@/components/ui/status-badge";
import { STATUS_LABELS, STATUS_COLORS } from "@/lib/task-colors";
import { EmptyState } from "@/components/empty-state";

// F013: extracted from
// app/(workspace)/w/[workspaceSlug]/watching/page.tsx so the same
// list-rendering (empty state + task rows) is shared, behaviour-identically,
// between that standalone route and the Inbox "Watching" tab -- neither
// duplicates the other's markup.
export function WatchingTaskList({
  workspaceSlug,
  watchedTasks,
}: {
  workspaceSlug: string;
  watchedTasks: WatchedTaskListItem[];
}) {
  if (watchedTasks.length === 0) {
    return (
      <EmptyState
        icon={Eye}
        title="You're not watching any tasks"
        description="Watch a task from its detail view to get notified about its activity here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {watchedTasks.map((task) => {
        const statusColor =
          STATUS_COLORS[task.status as keyof typeof STATUS_COLORS] ??
          "var(--muted-foreground)";
        const statusLabel =
          STATUS_LABELS[task.status as keyof typeof STATUS_LABELS] ?? task.status;
        return (
          <li key={task.taskId}>
            <Link
              href={
                task.taskKey
                  ? `/w/${workspaceSlug}/t/${task.taskKey}`
                  : `/w/${workspaceSlug}/projects/${task.projectId}/list`
              }
              className="flex flex-col gap-1.5 rounded-lg border p-3 transition-colors hover:bg-accent"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusBadge label={statusLabel} color={statusColor} />
                  <span className="truncate text-sm font-medium">{task.taskTitle}</span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {task.projectName}
                </span>
              </div>
              {task.lastActivitySummary && (
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {task.lastActivitySummary}
                </p>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
