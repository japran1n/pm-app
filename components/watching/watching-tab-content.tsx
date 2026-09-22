import { getWatchedTasksForUser } from "@/lib/queries/watching";
import { WatchingTaskList } from "@/components/watching/watching-task-list";

// F013: server-fetch wrapper reused by the Inbox "Watching" tab and by
// app/(workspace)/w/[workspaceSlug]/watching/page.tsx (F015 will make that
// page redirect here, not yet). Behaviour-identical to the old page's body.
export async function WatchingTabContent({
  workspaceSlug,
  userId,
}: {
  workspaceSlug: string;
  userId: string;
}) {
  const watchedTasks = await getWatchedTasksForUser(userId);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Tasks you&apos;re watching, sorted by the most recent activity.
      </p>
      <WatchingTaskList workspaceSlug={workspaceSlug} watchedTasks={watchedTasks} />
    </div>
  );
}
