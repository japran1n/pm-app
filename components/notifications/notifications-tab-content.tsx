import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
import { NotificationPanel } from "@/components/notifications/notification-panel";

// F013: server-fetch wrapper reused by the Inbox "Notifications" tab and by
// app/(workspace)/w/[workspaceSlug]/notifications/page.tsx (F015 will make
// that page redirect here, not yet). Behaviour-identical to the old page's
// body -- same limit, same <NotificationPanel>, same mark-read/mark-all
// logic defined in exactly one place (NotificationPanel itself).
const PAGE_LIMIT = 100;

export async function NotificationsTabContent({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string;
  workspaceId: string;
}) {
  const { list, unreadCount } = await getNotificationsForWorkspace(
    workspaceId,
    PAGE_LIMIT,
  );

  return (
    <NotificationPanel
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      initialNotifications={list}
      initialUnreadCount={unreadCount}
      emptyStateClassName="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center"
    />
  );
}
