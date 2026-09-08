import { redirect } from "next/navigation";
import Link from "next/link";
import { Eye } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getWatchedTasksForUser } from "@/lib/queries/watching";
import { StatusBadge } from "@/components/ui/status-badge";
import { STATUS_LABELS, STATUS_COLORS } from "@/lib/task-colors";
import { EmptyState } from "@/components/empty-state";

// Feature request "Watching feed": lists every task the signed-in caller
// is currently watching (F163/F164's task_watchers), sorted by most
// recent activity, with a short "what changed" summary per task.
//
// Access: relies on the workspace-membership layout guard above this route
// (app/(workspace)/w/[workspaceSlug]/layout.tsx), same convention every
// other page under /w/[workspaceSlug]/* already follows — reaching this
// page at all already means the caller is an active member. Task-level
// visibility is separately enforced by getWatchedTasksForUser's own RLS
// reliance (task_watchers/tasks/task_activity are each only readable
// through the caller's own session).
export default async function WatchingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const watchedTasks = await getWatchedTasksForUser(user.id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="title-1 font-semibold">Watching</h1>
        <p className="text-mini text-muted-foreground">
          Tasks you&apos;re watching, sorted by the most recent activity.
        </p>
      </div>

      {watchedTasks.length === 0 ? (
        <EmptyState
          icon={Eye}
          title="You're not watching any tasks"
          description="Watch a task from its detail view to get notified about its activity here."
        />
      ) : (
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
                      <span className="truncate text-mini font-medium">{task.taskTitle}</span>
                    </div>
                    <span className="shrink-0 text-micro text-muted-foreground">
                      {task.projectName}
                    </span>
                  </div>
                  {task.lastActivitySummary && (
                    <p className="line-clamp-1 text-micro text-muted-foreground">
                      {task.lastActivitySummary}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
