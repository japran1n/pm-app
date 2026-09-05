"use client";

// F208: the bell trigger + popover (AS-379). Client Component only for
// the interactive popover/badge state — initial data is server-fetched by
// the workspace layout and passed down as props, per the clarified
// spec's data-shape answer.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { useNotificationsRealtime } from "@/components/notifications/use-notifications-realtime";
import type { NotificationInsertEvent } from "@/lib/notifications/subscribe-notifications-realtime";
import { getNotificationSnapshot } from "@/lib/actions/notifications";
import { getNotificationPreferences } from "@/lib/actions/notification-preferences";
import { playNotificationSound } from "@/lib/notifications/sound";
import { useUnreadBadge } from "@/lib/notifications/use-unread-badge";
import { chatNotificationHref } from "@/lib/notifications/chat-link";
import type { NotificationListItem } from "@/lib/queries/notifications";

// Faza D (docs/chat-slack-parity-plan.md): sound + toast are only for the
// three chat-originated kinds (a DM, a thread reply, an @mention) --
// intentionally scoped to chat, not every notification kind this bell can
// show. A task_assigned/comment_reply/etc. still updates the badge exactly
// as before; it just doesn't also make a noise or pop a toast, matching
// this feature's "analyze the chat/communication system" scope.
const CHAT_TOAST_KINDS = new Set(["mention", "chat_dm", "chat_thread_reply"]);

function chatToastMessage(kind: string, actorName: string): string {
  if (kind === "chat_dm") return `${actorName} sent you a direct message`;
  if (kind === "chat_thread_reply") return `${actorName} replied to your thread`;
  return `${actorName} mentioned you`;
}

// app-sidebar.tsx mounts TWO NotificationBell instances at once (desktop
// header + `md:hidden` mobile top bar, same F332 responsive-duplicate
// pattern the sidebar already uses elsewhere) -- both receive the exact
// same Realtime insert event. A module-level (not component-level) set of
// already-handled notification ids is shared by every mounted instance,
// so the sound/toast side effect below fires once per notification, not
// once per mounted bell. Unbounded growth isn't a real concern: this is
// per-tab, in-memory, UUID-keyed, and cleared on reload.
const handledNotificationIds = new Set<string>();

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
  // F308 (FU-12 item 6): distinguishes "reconcile failed" from "reconcile
  // succeeded, badge is legitimately 0" — surfaced as a small visible
  // indicator on the trigger button rather than a silently-stale badge,
  // per this mission's "typed error, caller decides how to surface it"
  // convention.
  const [reconcileFailed, setReconcileFailed] = useState(false);

  const router = useRouter();

  // Faza D: this bell's unread count already drives document.title/favicon
  // badging for every workspace it's mounted in.
  useUnreadBadge(unreadCount);

  // Faza D: sound preferences, fetched once on mount rather than threaded
  // through every layout that renders this bell (the settings page already
  // owns the authoritative server-fetched copy for the preferences form;
  // this is a lightweight read-only client-side fetch purely for gating a
  // realtime side effect). Kept in a ref (not just state) so handleInsert's
  // realtime callback always reads the latest value without needing to be
  // in that callback's own dependency array — re-subscribing the realtime
  // channel on every preference change would be wasteful and pointless.
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
    if (!result.ok) {
      setReconcileFailed(true);
      return null;
    }
    setReconcileFailed(false);
    setUnreadCount(result.unreadCount);
    setLiveSnapshot({ list: result.list, unreadCount: result.unreadCount });
    setLiveSnapshotVersion((version) => version + 1);
    return result;
  }, [workspaceId]);

  const handleInsert = useCallback(
    (event: NotificationInsertEvent) => {
      // Client-side workspace narrowing: the subscription itself is
      // already scoped to this user's own rows at the transport level
      // (user_id=eq.<currentUserId>) per this feature's clarified Notes;
      // the bell only ever displays ONE workspace's inbox at a time
      // (lib/queries/notifications.ts's own workspace-scoped read path),
      // so an insert for a different workspace the caller also belongs to
      // is ignored here rather than incrementing the wrong workspace's
      // badge.
      if (event.workspaceId !== workspaceId) return;

      void reconcile().then((result) => {
        // Faza D: sound + toast, chat kinds only (see CHAT_TOAST_KINDS'
        // doc comment). The realtime payload itself only carries raw
        // columns (no resolved actor name) -- the just-reconciled
        // snapshot has the same row with `actor`/`chatMention` already
        // resolved, so this waits for reconcile rather than adding a
        // second query.
        if (!result || !CHAT_TOAST_KINDS.has(event.kind)) return;
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
            // F332 (M17 scrutiny BLOCKER-1 / AS-518): `size="icon"` alone is
            // `size-8` (32px) -- below the 44px touch-target minimum. This
            // trigger renders both in the always-visible desktop sidebar
            // header (>= md, mouse-driven, untouched) and inside the
            // `md:hidden` mobile top bar in app-sidebar.tsx (the actual
            // touch-target surface), so `max-md:size-11` matches the exact
            // breakpoint convention F265 already established for the
            // hamburger trigger right next to this button in that same bar.
            className="relative max-md:size-11"
            aria-label={
              reconcileFailed
                ? "Notifications, sync failed"
                : unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : "Notifications"
            }
            title={
              reconcileFailed
                ? "Couldn't sync notifications — showing the last known state."
                : undefined
            }
          >
            <Bell className="size-4" aria-hidden="true" />
            {/* AS-379: a bell shows the unread count. F308/FU-12 item 6: a
                failed reconcile shows a distinct muted-outline dot instead
                of either a stale count badge or silence. */}
            {reconcileFailed ? (
              <span
                className="absolute -top-1 -right-1 size-2.5 rounded-full border border-background bg-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full px-1 text-[10px] leading-none"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Badge>
              )
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
