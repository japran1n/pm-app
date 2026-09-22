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
  const { list: watchedTasks, error } = await getWatchedTasksForUser(userId);

  // F057 (FU-M4-10): a real fetch failure must never render the same
  // "not watching anything" empty state a legitimate zero-row result
  // would — throw so app/(workspace)/w/[workspaceSlug]/inbox/error.tsx
  // (and this route's own error.tsx) renders an error affordance instead,
  // matching F050's convention on RequestsTabContent.
  if (error) {
    throw new Error(error);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Tasks you&apos;re watching, sorted by the most recent activity.
      </p>
      <WatchingTaskList workspaceSlug={workspaceSlug} watchedTasks={watchedTasks} />
    </div>
  );
}
