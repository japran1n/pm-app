// F014 (SB-053, SB-054, SB-055): the sidebar's "Inbox" nav item now carries
// one aggregate badge instead of the notification bell's own separate
// unread count. This is a pure, unit-testable sum over the SAME per-source
// counts the app already computes elsewhere — never a new counting rule:
//
//   - unread notifications: `getNotificationsForWorkspace`'s own
//     `unreadCount` (lib/queries/notifications.ts) -- the exact number the
//     removed NotificationBell badge used to show.
//   - pending approvals: `getOpenApprovalCountForWorkspace`
//     (lib/queries/approvals.ts) -- the exact same count already feeding
//     the sidebar's "Approvals" nav item badge.
//   - open client requests: `getOpenClientRequestCountForWorkspace`
//     (lib/queries/client-requests.ts) -- the exact same count already
//     feeding the sidebar's "Client requests" nav item badge.
//
// Each source already fails open to 0 internally on its own fetch error
// (see each query's own doc comment), so this helper never needs to know
// about failure -- a failed source simply contributes 0, never throwing
// and never blocking the other two.
export type InboxBadgeCounts = {
  unreadNotifications: number;
  pendingApprovals: number;
  openRequests: number;
};

/** Clamps a possibly-negative/non-finite input to a safe non-negative
 * integer contribution -- defensive only; every real caller already
 * passes a `>= 0` count. */
function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * SB-053/SB-054: the Inbox nav item's badge count is the sum of unread
 * notifications, pending approvals, and open client requests -- hidden
 * (0) when every source is 0 or unavailable.
 */
export function inboxBadgeCount(counts: InboxBadgeCounts): number {
  return (
    safeCount(counts.unreadNotifications) +
    safeCount(counts.pendingApprovals) +
    safeCount(counts.openRequests)
  );
}
