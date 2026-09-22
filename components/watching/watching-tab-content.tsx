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

  return <WatchingTaskList workspaceSlug={workspaceSlug} watchedTasks={watchedTasks} />;
}
