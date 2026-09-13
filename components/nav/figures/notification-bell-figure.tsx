// F016 (AS-017): the notification bell's own async server component. This
// is the same "server-fetched in the layout" figure F208 originally wired
// up (`getNotificationsForWorkspace`), just moved into its own file and
// its own component so the layout body no longer has to `await` it as part
// of one big `Promise.all` -- the caller (the layout) wraps this in its
// own `<Suspense fallback={null}>` and streams it in independently of
// every other sidebar figure. No markup changed: this renders the exact
// same `<NotificationBell>` with the exact same props the layout used to
// pass down directly.
import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
import { NotificationBell } from "@/components/notifications/notification-bell";

export async function NotificationBellFigure({
  workspaceSlug,
  workspaceId,
  currentUserId,
}: {
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
}) {
  // F208 (AS-379): non-fatal -- the query already fails open to an empty
  // list / zero count internally, so a failure here still renders a bell
  // with no badge, never a broken layout.
  const { list: initialNotifications, unreadCount: initialUnreadCount } =
    await getNotificationsForWorkspace(workspaceId);

  return (
    <NotificationBell
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      initialNotifications={initialNotifications}
      initialUnreadCount={initialUnreadCount}
    />
  );
}
