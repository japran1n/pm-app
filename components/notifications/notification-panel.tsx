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
import { useEffect, useState, useTransition } from "react";
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
import { chatNotificationHref } from "@/lib/notifications/chat-link";

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
    // task_due_soon is rendered by a dedicated branch below (it has no
    // actor -- F212's hourly pg_cron sweep always inserts it with
    // `p_actor_id => null`, a genuine system-generated reminder, not a
    // person-caused event) and never reaches this switch, but the case is
    // kept here so `NotificationKind`'s exhaustiveness isn't silently
    // broken by removing it.
    case "task_due_soon":
      return "is due soon:";
    case "watcher_update":
      return "updated a task you're watching:";
    // Faza D (docs/chat-slack-parity-plan.md): composes with itemLabel
    // below the same way every other kind does -- "sent you" + "a direct
    // message", "replied to" + "your thread".
    case "chat_dm":
      return "sent you";
    case "chat_thread_reply":
      return "replied to";
    default:
      return "sent an update on";
  }
}

function taskLabel(task: NotificationListItem["task"]): string {
  if (!task) return "a task";
  if (task.title === null) return "a deleted task";
  return task.key ? `${task.key} ${task.title}` : task.title;
}

// F13 (docs/advanced-chat-plan.md): a chat mention has no task at all --
// distinct label so the row reads "mentioned you in a message" rather
// than the task-oriented "mentioned you in a task" default. Faza D:
// chat_dm/chat_thread_reply get their own more specific noun phrase for
// the same "no task" case, composing with actionLabel's "sent you" /
// "replied to" above.
function itemLabel(notification: NotificationListItem): string {
  if (!notification.task && notification.chatMention) {
    if (notification.kind === "chat_dm") return "a direct message";
    if (notification.kind === "chat_thread_reply") return "your thread";
    return "a message";
  }
  return taskLabel(notification.task);
}

// AS-386 follow-up: the board page now reads a `?taskId=` query param and
// opens that task's detail sheet on mount (components/board/board.tsx),
// so a notification with a resolvable task + project now links straight
// there instead of the workspace search page. The search-page link is
// kept as a fallback ONLY for the genuinely unresolvable case — the task
// itself is gone (`title === null`) or its project id couldn't be
// resolved (e.g. the project itself was deleted alongside it) — since a
// board URL with no `projectId` segment can't be built at all.
// F304 (AS-374 follow-up): `commentId`, when present, is appended as an
// additional query param so the board deep-link can also scroll to and
// highlight the specific comment (components/board/board.tsx reads
// `?taskId=`; the task detail sheet/comment list read `?commentId=` once
// the sheet opens — see this feature's other changes). Only appended on
// the board-deep-link branch — the search-page fallback has nowhere
// meaningful to carry it.
function taskHref(
  workspaceSlug: string,
  task: NotificationListItem["task"],
  commentId: string | null,
): string | null {
  if (!task || task.title === null) return null;
  if (task.projectId) {
    const base = `/w/${workspaceSlug}/projects/${task.projectId}/board?taskId=${encodeURIComponent(task.id)}`;
    return commentId ? `${base}&commentId=${encodeURIComponent(commentId)}` : base;
  }
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
  liveSnapshot,
  liveSnapshotVersion,
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
  /** F209 (AS-388): a fresh server snapshot pushed down from
   * NotificationBell after a Realtime insert or a tab-focus
   * reconciliation (see lib/actions/notifications.ts's
   * getNotificationSnapshot). Optional and undefined by default so every
   * pre-F209 caller/test that doesn't pass it keeps behaving exactly as
   * before — this panel stays the sole owner of its `notifications`
   * state otherwise. When `liveSnapshotVersion` changes and `liveSnapshot`
   * is present, that snapshot REPLACES local state wholesale: it's the
   * server-authoritative truth (same query the initial render used), so
   * there is no second, independently-maintained copy to drift from it. */
  liveSnapshot?: { list: NotificationListItem[]; unreadCount: number } | null;
  liveSnapshotVersion?: number;
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  // ARCH-009: while the panel is open, a revalidate/router.refresh() can
  // deliver fresh `initialNotifications`/`initialUnreadCount` — previously
  // ignored (state seeded once at mount), so the open panel kept a stale
  // list until re-opened. Re-sync during render, per the repo's
  // "adjusting state when a prop changes" convention
  // (components/workspace/task-type-manager.tsx). Local state only:
  // `onUnreadCountChange` is a PARENT-owned setter and must not be called
  // during this component's render (see the useEffect below) — and the
  // parent derived `initialUnreadCount` from the same server data, so it
  // is already consistent. The AS-388 liveSnapshot path below stays as is;
  // both sources are server-authoritative snapshots, so whichever arrives
  // later simply wins.
  const [syncedInitialNotifications, setSyncedInitialNotifications] =
    useState(initialNotifications);
  if (initialNotifications !== syncedInitialNotifications) {
    setSyncedInitialNotifications(initialNotifications);
    setNotifications(initialNotifications);
    setUnreadCount(initialUnreadCount);
  }
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [isMarkingAll, startMarkAllTransition] = useTransition();

  // AS-388: a Realtime insert or tab-focus reconciliation up in
  // NotificationBell resolves into a fresh server snapshot; when it
  // changes, this open panel adopts it directly instead of a second
  // client-maintained list/counter. Adjusted during render (React's
  // documented "adjusting state when a prop changes" pattern —
  // https://react.dev/learn/you-might-not-need-an-effect) rather than in
  // a useEffect, so the panel never briefly commits/paints the stale
  // list before catching up a tick later.
  //
  // F272 (part 2, AS-388 regression): this panel only mounts while the
  // popover is open (Base UI's Popover.Portal doesn't keep its Popup
  // mounted while closed) — a fresh mount every time it's opened, not
  // once per page load. Seeding `appliedSnapshotVersion` FROM
  // `liveSnapshotVersion` (the prop's CURRENT value at that mount) meant
  // that opening the panel any time AFTER NotificationBell had already
  // reconciled at least once (e.g. this exact scenario: a live insert
  // arrives and bumps the version while the popover is still closed, THEN
  // the user opens it) made the very first render's guard below
  // (`liveSnapshotVersion !== appliedSnapshotVersion`) compare a value
  // against ITSELF — always false — so the real, already-fetched snapshot
  // was silently never applied, and the panel rendered the stale
  // `initialNotifications` (from the ORIGINAL page load, before the
  // insert) instead, while the bell's own badge (which does not remount)
  // correctly showed the live count. A version number that can never
  // equal a real one is used instead of the prop's own runtime value, so
  // ANY defined `liveSnapshotVersion` present at mount — whenever that
  // mount happens to occur — is always treated as "not yet applied" and
  // gets merged in immediately.
  const [appliedSnapshotVersion, setAppliedSnapshotVersion] =
    useState<number>(-1);
  // Moved into a useEffect (rather than the render-time "adjusting state
  // when a prop changes" pattern the comment above originally called for):
  // calling `onUnreadCountChange` -- a SETTER OWNED BY THE PARENT
  // (NotificationBell) -- synchronously during this component's render
  // triggers React's "Cannot update a component while rendering a
  // different component" warning/error, since updating another
  // component's state is not safe during this component's render phase.
  // The local `setNotifications`/`setUnreadCount`/`setAppliedSnapshotVersion`
  // calls are fine to keep alongside it here since they must all apply
  // atomically with the same guard condition.
  useEffect(() => {
    if (
      liveSnapshot &&
      liveSnapshotVersion !== undefined &&
      liveSnapshotVersion !== appliedSnapshotVersion
    ) {
      const timer = setTimeout(() => {
        setAppliedSnapshotVersion(liveSnapshotVersion);
        setNotifications(liveSnapshot.list);
        setUnreadCount(liveSnapshot.unreadCount);
        onUnreadCountChange?.(liveSnapshot.unreadCount);
      }, 0);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSnapshot, liveSnapshotVersion]);

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
            const href =
              taskHref(workspaceSlug, notification.task, notification.commentId ?? null) ??
              chatNotificationHref(workspaceSlug, notification.chatMention ?? null);
            const isUnread = !notification.readAt;

            // task_due_soon is system-generated (F212's hourly pg_cron
            // sweep always inserts it with `p_actor_id => null` -- no
            // person triggered it), so it gets its own sentence with no
            // "Someone"/actor prefix instead of being forced through the
            // actor+action+item template every person-caused kind uses.
            const isSystemNotification = notification.kind === "task_due_soon";

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
                    {isSystemNotification ? (
                      <>
                        A task you&apos;re watching {actionLabel(notification.kind)}{" "}
                        <span className="font-medium">
                          {itemLabel(notification)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium">
                          {notification.actor?.name ??
                            notification.actor?.email ??
                            "Someone"}
                        </span>{" "}
                        {actionLabel(notification.kind)}{" "}
                        <span className="font-medium">
                          {itemLabel(notification)}
                        </span>
                      </>
                    )}
                  </p>
                  <span className="font-mono text-xs text-muted-foreground">
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
                    className="block rounded-md hover:bg-muted/50"
                    onClick={() => handleMarkRead(notification)}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="block w-full rounded-md text-left hover:bg-muted/50"
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
