"use client";

// F208: the bell trigger + popover (AS-379). Client Component only for
// the interactive popover/badge state — initial data is server-fetched by
// the workspace layout and passed down as props, per the clarified
// spec's data-shape answer.
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { useNotificationsRealtime } from "@/components/notifications/use-notifications-realtime";
import { getNotificationSnapshot } from "@/lib/actions/notifications";
import type { NotificationListItem } from "@/lib/queries/notifications";

export function NotificationBell({
  workspaceSlug,
  workspaceId,
  currentUserId,
  initialNotifications,
  initialUnreadCount,
}: {
  workspaceSlug: string;
  workspaceId: string;
  /** F209 (AS-388): required to scope the Realtime subscription to this
   * user's own notifications at the subscription level (`filter:
   * user_id=eq.<currentUserId>`), not merely via RLS + a client-side
   * filter after delivery — see subscribe-notifications-realtime.ts.
   * Optional so pre-F209 callers/tests that don't pass it keep rendering
   * the bell's static (non-realtime) behaviour instead of crashing —
   * realtime simply stays off without it. */
  currentUserId?: string | null;
  initialNotifications: NotificationListItem[];
  initialUnreadCount: number;
}) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [open, setOpen] = useState(false);
  const [liveSnapshot, setLiveSnapshot] = useState<{
    list: NotificationListItem[];
    unreadCount: number;
  } | null>(null);
  const [liveSnapshotVersion, setLiveSnapshotVersion] = useState(0);

  // AS-388: the single reconciliation path — always re-fetches the
  // server-authoritative snapshot (lib/actions/notifications.ts's
  // getNotificationSnapshot, the exact query the initial SSR used)
  // rather than incrementing a client-side counter, so a missed Realtime
  // event can never leave the badge permanently wrong.
  const reconcile = useCallback(async () => {
    const result = await getNotificationSnapshot(workspaceId);
    if (!result.ok) return;
    setUnreadCount(result.unreadCount);
    setLiveSnapshot({ list: result.list, unreadCount: result.unreadCount });
    setLiveSnapshotVersion((version) => version + 1);
  }, [workspaceId]);

  const handleInsert = useCallback(
    (event: { workspaceId: string }) => {
      // Client-side workspace narrowing: the subscription itself is
      // already scoped to this user's own rows at the transport level
      // (user_id=eq.<currentUserId>) per this feature's clarified Notes;
      // the bell only ever displays ONE workspace's inbox at a time
      // (lib/queries/notifications.ts's own workspace-scoped read path),
      // so an insert for a different workspace the caller also belongs to
      // is ignored here rather than incrementing the wrong workspace's
      // badge.
      if (event.workspaceId !== workspaceId) return;
      void reconcile();
    },
    [workspaceId, reconcile],
  );

  useNotificationsRealtime(currentUserId, handleInsert);

  // AS-388 (Draft scope): "reconcile against the server count on tab
  // focus so a missed event cannot leave the badge permanently wrong."
  const hasCurrentUser = Boolean(currentUserId);
  const reconcileRef = useRef(reconcile);
  useEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);
  useEffect(() => {
    if (!hasCurrentUser) return;

    function onVisibilityOrFocus() {
      if (document.visibilityState === "hidden") return;
      void reconcileRef.current();
    }

    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
    };
  }, [hasCurrentUser]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
          >
            <Bell className="size-4" aria-hidden="true" />
            {/* AS-379: a bell shows the unread count. */}
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full px-1 text-[10px] leading-none"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-2">
        <NotificationPanel
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
          initialNotifications={initialNotifications}
          initialUnreadCount={initialUnreadCount}
          onUnreadCountChange={setUnreadCount}
          liveSnapshot={liveSnapshot}
          liveSnapshotVersion={liveSnapshotVersion}
        />
      </PopoverContent>
    </Popover>
  );
}
