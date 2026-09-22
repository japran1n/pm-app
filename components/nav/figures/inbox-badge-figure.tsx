// F014 (SB-053, SB-054, SB-055): the sidebar "Inbox" nav item's own async
// server component, same F016 figure shape as approvals-badge-figure.tsx /
// requests-badge-figure.tsx / chat-unread-badge-figure.tsx (see those
// files' own header comments) -- fetches its own counts rather than the
// layout awaiting them, wrapped by the layout in its own `<Suspense
// fallback={null}>`.
//
// This REPLACES the removed NotificationBell's own unread badge with one
// aggregate number: unread notifications + pending approvals + open
// client requests (`lib/inbox/inbox-badge-count.ts`'s pure sum -- see that
// file's own doc comment for why these three sources and no others).
//
// FU-M4-4 (M4 scrutiny, SB-054): approvals/requests are only fetched for a
// caller who can actually reach those two queues -- the SAME two-part gate
// the sidebar itself applies to its "Client requests"/"Approvals" nav
// items (components/nav/app-sidebar.tsx): `!isGuest` AND `hasClient` (a
// workspace with no client at all never shows those nav items either, so
// their counts must never inflate this badge). The previous version of
// this file only checked `isGuest`, which left this badge counting
// approvals/requests for a client-less workspace even though the nav items
// contributing those counts were never rendered for anyone.
import { logger } from "@/lib/observability/logger";
import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
import { getOpenApprovalCountForWorkspace } from "@/lib/queries/approvals";
import { getOpenClientRequestCountForWorkspace } from "@/lib/queries/client-requests";
import { inboxBadgeCount } from "@/lib/inbox/inbox-badge-count";
import { Badge } from "@/components/ui/badge";

function resolvedOrZero(
  result: PromiseSettledResult<number>,
  label: string,
): number {
  if (result.status === "fulfilled") {
    return result.value;
  }
  logger.error(`InboxBadgeFigure: failed to look up ${label}`, {
    error: result.reason,
  });
  return 0;
}

export async function InboxBadgeFigure({
  workspaceId,
  isGuest,
  hasClient,
}: {
  workspaceId: string;
  isGuest: boolean;
  hasClient: boolean;
}) {
  // FU-M4-4 (SB-054): approvals/requests only contribute when the caller
  // both isn't a guest AND the workspace actually has a client -- matching
  // app-sidebar.tsx's own `!isGuest` (guestExcluded) + `hasClient` gate for
  // those exact two nav items.
  const approvalsRequestsGated = isGuest || !hasClient;

  // FU-M4-4 (M4 scrutiny): `Promise.allSettled` (not `Promise.all` +
  // per-source `.catch`) so this figure can tell "every source resolved,
  // sum is legitimately 0" apart from "a source actually failed" --
  // restoring the same `reconcileFailed` distinction the removed
  // NotificationBell surfaced (components/notifications/notification-bell.tsx)
  // instead of the flattened "on any error, contribute a silent 0" this
  // file previously replaced it with.
  const [notificationsResult, approvalsResult, requestsResult] = await Promise.allSettled([
    getNotificationsForWorkspace(workspaceId).then((result) => result.unreadCount),
    approvalsRequestsGated
      ? Promise.resolve(0)
      : getOpenApprovalCountForWorkspace(workspaceId),
    approvalsRequestsGated
      ? Promise.resolve(0)
      : getOpenClientRequestCountForWorkspace(workspaceId),
  ]);

  const reconcileFailed = [notificationsResult, approvalsResult, requestsResult].some(
    (result) => result.status === "rejected",
  );

  const unreadNotifications = resolvedOrZero(notificationsResult, "unread notifications");
  const pendingApprovals = resolvedOrZero(approvalsResult, "open approvals");
  const openRequests = resolvedOrZero(requestsResult, "open client requests");

  const count = inboxBadgeCount({
    unreadNotifications,
    pendingApprovals,
    openRequests,
  });

  // FU-M4-4 (SB-054): a failed reconcile is never indistinguishable from a
  // legitimate zero -- shown as the same small muted-outline dot the bell
  // used, rather than either a stale/wrong count or silence (no badge).
  if (reconcileFailed) {
    return (
      <span
        className="ml-auto size-2.5 shrink-0 rounded-full border border-background bg-muted-foreground"
        aria-label="Inbox count unavailable"
        title="Couldn't sync Inbox counts — showing the last known state."
      />
    );
  }

  if (count <= 0) {
    return null;
  }

  return (
    <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px] font-mono">
      {count > 99 ? "99+" : count}
    </Badge>
  );
}
