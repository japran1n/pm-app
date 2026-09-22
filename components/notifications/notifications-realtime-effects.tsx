"use client";

// F014: the notification bell was removed from the sidebar (its unread
// count is now folded into the Inbox nav item's aggregate badge, see
// components/nav/figures/inbox-badge-figure.tsx), but
// components/notifications/notification-bell.tsx mounted several side
// effects that have nothing to do with its own popover UI and are still
// needed:
//
//   - a live Supabase Realtime subscription on the caller's own
//     notifications (F209, AS-388) that drives a chat toast + sound
//     (Faza D), a desktop/browser notification for mentions and
//     approval-related kinds, and the document title/favicon "(N)"
//     unread badge (useUnreadBadge).
//   - reconciling the server-authoritative unread count on tab focus/
//     visibility change, so a missed Realtime event can never leave any
//     of the above permanently stale.
//
// Per this feature's clarified instruction ("verify NotificationBell
// doesn't mount any realtime/subscription side effects needed elsewhere;
// if it does, move that effect to a place that still runs"), this
// component is that new place: a headless (renders null) Client Component
// mounted once in the workspace layout, alongside the other persistent
// providers (MembershipProvider, WorkspacePresenceProvider), so it keeps
// running on every page under `/w/[workspaceSlug]/*` regardless of
// whether the Inbox page itself is open. notification-bell.tsx and
// notification-bell-figure.tsx have since been deleted outright (F059,
// SB-055) now that nothing references them any more.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useNotificationsRealtime } from "@/components/notifications/use-notifications-realtime";
import type { NotificationInsertEvent } from "@/lib/notifications/subscribe-notifications-realtime";
import { getNotificationSnapshot } from "@/lib/actions/notifications";
import { getNotificationPreferences } from "@/lib/actions/notification-preferences";
import { playNotificationSound } from "@/lib/notifications/sound";
import { useUnreadBadge } from "@/lib/notifications/use-unread-badge";
import { chatNotificationHref } from "@/lib/notifications/chat-link";
import { showDesktopNotification } from "@/lib/notifications/browser-notify";

// Faza D: sound + toast are only for the three chat-originated kinds --
// same set notification-bell.tsx's own CHAT_TOAST_KINDS uses.
const CHAT_TOAST_KINDS = new Set(["mention", "chat_dm", "chat_thread_reply"]);

function chatToastMessage(kind: string, actorName: string): string {
  if (kind === "chat_dm") return `${actorName} sent you a direct message`;
  if (kind === "chat_thread_reply") return `${actorName} replied to your thread`;
  return `${actorName} mentioned you`;
}

// Same set notification-bell.tsx's own DESKTOP_NOTIFY_KINDS uses.
const DESKTOP_NOTIFY_KINDS = new Set(["mention", "approval_owner_nudge", "approval_decided"]);

function desktopNotificationBody(kind: string, actorName: string): string {
  if (kind === "approval_owner_nudge") return "An approval is waiting on your decision.";
  if (kind === "approval_decided") return `${actorName} decided on your approval request.`;
  return `${actorName} mentioned you`;
}

// Only one instance of this component is ever mounted (the layout, once)
// -- unlike the old bell (mounted twice, desktop + mobile), so there is no
// "same event, two mounted instances" dedup problem to solve here. Kept as
// module-level sets anyway, same convention as notification-bell.tsx, in
// case a future caller ever mounts this twice.
const handledNotificationIds = new Set<string>();
const handledDesktopNotificationIds = new Set<string>();

/**
 * Headless: renders nothing. Mounted once per workspace layout render
 * (see app/(workspace)/w/[workspaceSlug]/layout.tsx) so the notification
 * Realtime subscription, chat sound/toast, desktop notifications, and the
 * document title/favicon unread badge keep working with no visible bell
 * in the sidebar.
 */
export function NotificationsRealtimeEffects({
  workspaceId,
  workspaceSlug,
  currentUserId,
  initialUnreadCount,
}: {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId?: string | null;
  initialUnreadCount: number;
}) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const router = useRouter();

  useUnreadBadge(unreadCount);

  const soundPrefsRef = useRef({
    enabled: true,
    volume: 60,
    onlyWhenUnfocused: true,
  });
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    void getNotificationPreferences().then((result) => {
      if (cancelled || !result.ok) return;
      soundPrefsRef.current = {
        enabled: result.data.soundEnabled,
        volume: result.data.soundVolume,
        onlyWhenUnfocused: result.data.soundOnlyWhenUnfocused,
      };
    });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const reconcile = useCallback(async () => {
    const result = await getNotificationSnapshot(workspaceId);
    if (!result.ok) return null;
    setUnreadCount(result.unreadCount);
    return result;
  }, [workspaceId]);

  const handleInsert = useCallback(
    (event: NotificationInsertEvent) => {
      if (event.workspaceId !== workspaceId) return;

      void reconcile().then((result) => {
        if (!result) return;

        if (
          DESKTOP_NOTIFY_KINDS.has(event.kind) &&
          !handledDesktopNotificationIds.has(event.id)
        ) {
          handledDesktopNotificationIds.add(event.id);
          const tabIsHidden =
            typeof document !== "undefined" &&
            (document.hidden || !document.hasFocus());
          if (tabIsHidden) {
            const freshForDesktop = result.list.find((n) => n.id === event.id);
            const actorName =
              freshForDesktop?.actor?.name ?? freshForDesktop?.actor?.email ?? "Someone";
            const href = chatNotificationHref(workspaceSlug, freshForDesktop?.chatMention ?? null);
            showDesktopNotification("Goodguys Studio", {
              body: desktopNotificationBody(event.kind, actorName),
              onClick: () => {
                if (href) router.push(href);
              },
            });
          }
        }

        if (!CHAT_TOAST_KINDS.has(event.kind)) return;
        if (handledNotificationIds.has(event.id)) return;
        handledNotificationIds.add(event.id);
        const fresh = result.list.find((n) => n.id === event.id);
        if (!fresh) return;

        const prefs = soundPrefsRef.current;
        const tabIsHidden =
          typeof document !== "undefined" &&
          (document.hidden || !document.hasFocus());
        if (prefs.enabled && (!prefs.onlyWhenUnfocused || tabIsHidden)) {
          playNotificationSound(prefs.volume);
        }

        const actorName = fresh.actor?.name ?? fresh.actor?.email ?? "Someone";
        const href = chatNotificationHref(workspaceSlug, fresh.chatMention);
        toast(chatToastMessage(event.kind, actorName), {
          action: href
            ? { label: "Open", onClick: () => router.push(href) }
            : undefined,
        });
      });
    },
    [workspaceId, workspaceSlug, reconcile, router],
  );

  useNotificationsRealtime(currentUserId, handleInsert);

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

  return null;
}
