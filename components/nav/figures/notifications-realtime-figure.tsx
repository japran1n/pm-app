// F014: replaces notification-bell-figure.tsx's use in the layout body --
// same "own async server component, streamed independently" F016 shape,
// but fetches only what NotificationsRealtimeEffects needs (the initial
// unread count, to seed the document title/favicon badge) and renders the
// headless effects component instead of the visible bell. See that
// component's own header comment for why the bell's realtime effects had
// to move here rather than being dropped when the bell left the sidebar.
import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
import { NotificationsRealtimeEffects } from "@/components/notifications/notifications-realtime-effects";

export async function NotificationsRealtimeFigure({
  workspaceSlug,
  workspaceId,
  currentUserId,
}: {
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
}) {
  // Non-fatal: getNotificationsForWorkspace already fails open to
  // unreadCount: 0 internally on its own fetch error.
  const { unreadCount: initialUnreadCount } = await getNotificationsForWorkspace(workspaceId);

  return (
    <NotificationsRealtimeEffects
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      initialUnreadCount={initialUnreadCount}
    />
  );
}
