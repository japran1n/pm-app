"use client";

// F208: the notification list rendered inside the bell's popover (and
// reused as-is by the full notifications page for older items) —
// AS-385, AS-386, AS-387.
//
// Server-fetched initial data (per the clarified spec's "server-fetched
// in the page/layout and passed down as typed props" answer): the caller
// (components/notifications/notification-bell.tsx or the notifications
// page) fetches via lib/queries/notifications.ts and passes the result
// down; this component owns only the interactive part — marking read,
// optimistic update + revert on failure.
import { useState, useTransition } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Bell, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/actions/notifications";
import type { NotificationKind, NotificationListItem } from "@/lib/queries/notifications";

// AS-385: "actor, action, and task" — the action half is derived purely
// from `kind` (F206/F207's closed vocabulary), since no notification kind
// this feature reads carries any other free-text description in its
// payload (F207's fan-out calls all pass an empty payload — see that
// feature's create_notification call sites) — deriving the sentence from
// `kind` alone is the ONE source of truth for this text, not a second
// copy of a description string that could drift from what actually
// happened.
function actionLabel(kind: NotificationKind): string {
  switch (kind) {
    case "mention":
      return "mentioned you in";
    case "comment_reply":
      return "replied on";
    case "task_assigned":
      return "assigned you to";
    case "task_due_soon":
      return "a task you're watching is due soon:";
    case "watcher_update":
      return "updated a task you're watching:";
    default:
      return "sent an update on";
  }
}

function taskLabel(task: NotificationListItem["task"]): string {
  if (!task) return "a task";
  if (task.title === null) return "a deleted task";
  return task.key ? `${task.key} ${task.title}` : task.title;
}

function taskHref(
  workspaceSlug: string,
  task: NotificationListItem["task"],
): string | null {
  // Out-of-scope (see this feature's handoff): there is no deep-link
  // route yet that opens a specific task's detail sheet from a bare URL
  // — board/list pages hold the open task purely in client state
  // (components/board/board.tsx's onCardClick), not a URL search param.
  // Navigating to the workspace search page pre-filled with this task's
  // key is the closest reachable "item" today without touching board/list
  // page internals, which this feature's Files list does not include.
  if (!task || task.title === null) return null;
  return task.key
    ? `/w/${workspaceSlug}/search?q=${encodeURIComponent(task.key)}`
    : null;
}

export function NotificationPanel({
  workspaceSlug,
  workspaceId,
  initialNotifications,
  initialUnreadCount,
  onUnreadCountChange,
  emptyStateClassName,
}: {
  workspaceSlug: string;
  workspaceId: string;
  initialNotifications: NotificationListItem[];
  initialUnreadCount: number;
  /** Bell badge lives one level up; this keeps the badge in sync with
   * whatever this panel does (mark one read, mark all read) without a
   * second fetch. */
  onUnreadCountChange?: (nextCount: number) => void;
  emptyStateClassName?: string;
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [isMarkingAll, startMarkAllTransition] = useTransition();

  function updateUnreadCount(next: number) {
    setUnreadCount(next);
    onUnreadCountChange?.(next);
  }

  // AS-386: clicking navigates to the item and marks it read. Optimistic:
  // the row flips to "read" and the badge decrements immediately; a
  // failed server call reverts both and shows a toast (per the clarified
  // "optimistic change reverts and a sonner toast states what failed"
  // answer).
  function handleMarkRead(notification: NotificationListItem) {
    if (notification.readAt || markingId === notification.id) return;

    const previousNotifications = notifications;
    const previousUnreadCount = unreadCount;

    setMarkingId(notification.id);
    setNotifications((previous) =>
      previous.map((item) =>
        item.id === notification.id
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    updateUnreadCount(Math.max(0, unreadCount - 1));

    markNotificationRead(notification.id).then((result) => {
      setMarkingId(null);
      if (!result.ok) {
        setNotifications(previousNotifications);
        updateUnreadCount(previousUnreadCount);
        toast.error(result.error);
      }
    });
  }

  // AS-387: mark-all-as-read clears the count.
  function handleMarkAll() {
    if (unreadCount === 0 || isMarkingAll) return;

    const previousNotifications = notifications;
    const previousUnreadCount = unreadCount;

    setNotifications((previous) =>
      previous.map((item) => ({
        ...item,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
    );
    updateUnreadCount(0);

    startMarkAllTransition(async () => {
      const result = await markAllNotificationsRead(workspaceId);
      if (!result.ok) {
        setNotifications(previousNotifications);
        updateUnreadCount(previousUnreadCount);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-semibold">Notifications</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled={unreadCount === 0 || isMarkingAll}
          onClick={handleMarkAll}
        >
          {isMarkingAll ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-3.5" aria-hidden="true" />
          )}
          Mark all as read
        </Button>
      </div>

      {notifications.length === 0 ? (
        <div
          className={
            emptyStateClassName ??
            "flex flex-col items-center gap-2 py-8 text-center"
          }
        >
          <Bell className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            You&apos;re all caught up. No notifications yet.
          </p>
        </div>
      ) : (
        <ul className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
          {notifications.map((notification) => {
            const href = taskHref(workspaceSlug, notification.task);
            const isUnread = !notification.readAt;

            const content = (
              <div
                className={`flex items-start gap-2.5 rounded-md px-2 py-2 text-sm ${
                  isUnread ? "bg-accent/40" : ""
                }`}
              >
                <UserAvatar
                  person={
                    notification.actor ?? {
                      id: `system-${notification.id}`,
                      name: "System",
                      email: null,
                      avatarUrl: null,
                    }
                  }
                  size="sm"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-sm leading-snug">
                    <span className="font-medium">
                      {notification.actor?.name ??
                        notification.actor?.email ??
                        "Someone"}
                    </span>{" "}
                    {actionLabel(notification.kind)}{" "}
                    <span className="font-medium">
                      {taskLabel(notification.task)}
                    </span>
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(notification.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                {isUnread && (
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                  />
                )}
                {markingId === notification.id && (
                  <Loader2
                    className="mt-1 size-3 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </div>
            );

            return (
              <li key={notification.id}>
                {href ? (
                  <Link
                    href={href}
                    className="block rounded-md hover:bg-accent/60"
                    onClick={() => handleMarkRead(notification)}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="block w-full rounded-md text-left hover:bg-accent/60"
                    onClick={() => handleMarkRead(notification)}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href={`/w/${workspaceSlug}/notifications`}
        className="px-1 py-1 text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        View all notifications
      </Link>
    </div>
  );
}
