import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getWatchedTasksForUser } from "@/lib/queries/watching";
// F013: list-rendering itself now lives in this shared component, reused
// behaviour-identically by the Inbox "Watching" tab -- see that file's own
// header comment.
import { WatchingTaskList } from "@/components/watching/watching-task-list";

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
  const { user } = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const watchedTasks = await getWatchedTasksForUser(user.id);

  return (
    <div className="flex flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Watching</h1>
        <p className="text-sm text-muted-foreground">
          Tasks you&apos;re watching, sorted by the most recent activity.
        </p>
      </div>

      <WatchingTaskList workspaceSlug={workspaceSlug} watchedTasks={watchedTasks} />
    </div>
  );
}
