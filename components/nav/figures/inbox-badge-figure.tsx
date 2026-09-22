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
// Approvals/requests are only fetched for a non-guest caller, matching the
// exact same `guestExcluded` gate the sidebar already applies to those two
// nav items themselves (components/nav/app-sidebar.tsx) -- a guest never
// sees a count that includes numbers from pages it can't reach.
import { logger } from "@/lib/observability/logger";
import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
import { getOpenApprovalCountForWorkspace } from "@/lib/queries/approvals";
import { getOpenClientRequestCountForWorkspace } from "@/lib/queries/client-requests";
import { inboxBadgeCount } from "@/lib/inbox/inbox-badge-count";
import { Badge } from "@/components/ui/badge";

export async function InboxBadgeFigure({
  workspaceId,
  isGuest,
}: {
  workspaceId: string;
  isGuest: boolean;
}) {
  // Every source below already fails open to 0 on its own fetch error (see
  // each query's own doc comment) -- this figure adds one more layer of
  // defense (a `.catch` per source) so a rejected promise from any one of
  // them can never take the other two, or the whole nav item, down with
  // it. SB-055: a failure here means "no badge", never a broken sidebar.
  const [unreadNotifications, pendingApprovals, openRequests] = await Promise.all([
    getNotificationsForWorkspace(workspaceId)
      .then((result) => result.unreadCount)
      .catch((error) => {
        logger.error("InboxBadgeFigure: failed to look up unread notifications", { error });
        return 0;
      }),
    isGuest
      ? Promise.resolve(0)
      : getOpenApprovalCountForWorkspace(workspaceId).catch((error) => {
          logger.error("InboxBadgeFigure: failed to look up open approvals", { error });
          return 0;
        }),
    isGuest
      ? Promise.resolve(0)
      : getOpenClientRequestCountForWorkspace(workspaceId).catch((error) => {
          logger.error("InboxBadgeFigure: failed to look up open client requests", { error });
          return 0;
        }),
  ]);

  const count = inboxBadgeCount({
    unreadNotifications,
    pendingApprovals,
    openRequests,
  });

  if (count <= 0) {
    return null;
  }

  return (
    <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px] font-mono">
      {count > 99 ? "99+" : count}
    </Badge>
  );
}
