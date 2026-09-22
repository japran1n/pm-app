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
//
// F054 (FU-M4-7, SB-054): `reconcileFailed` is now derived from each
// query's own typed `error` field (getNotificationsForWorkspace's
// `error`/`unreadError`-equivalent shape, and the matching `{ count,
// error }` shape `getOpenApprovalCountForWorkspace` /
// `getOpenClientRequestCountForWorkspace` now return -- see those files'
// own doc comments), never from a `Promise.allSettled` rejection. None of
// these three query functions ever reject: each fails open internally
// (network/DB errors are caught, logged, and turned into `{ ..., error:
// "..." }` or a bare `0`/`[]`), so a `Promise.allSettled` rejection branch
// was dead code that could never actually fire -- the real error signal
// was always the typed `error` field, which this file previously ignored
// entirely for approvals/requests and read from the wrong field
// (`unreadCount`'s sibling `error`) for notifications.
//
// F060 (SB-054): approvals/requests gating now uses the SAME predicate as
// the Inbox tabs themselves (`getVisibleInboxTabs` / `lib/inbox/visible-tabs.ts`,
// F049) instead of the sidebar nav item's own `isGuest || !hasClient` gate.
// Those two gates diverged: the nav items (and the old gate here) hid for
// guests and client-less workspaces, but the actual `/inbox?tab=approvals`
// and `?tab=requests` tab content -- gated only on `role !== "client"` --
// stayed reachable for both. A guest (or a caller in a client-less
// workspace) could open those tabs and see real counts while this badge
// silently excluded them from the aggregate, so the number in the sidebar
// never matched what the tabs actually showed. Passing `isClient` (which,
// like the tab-page itself, is always `false` here -- the workspace layout
// already redirects an actual `client` role to `/portal/*` before this
// component ever renders) keeps the two in lockstep for every future
// caller, not just the ones excluded by the retired guest/hasClient rule.
import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
import { getOpenApprovalCountForWorkspace } from "@/lib/queries/approvals";
import { getOpenClientRequestCountForWorkspace } from "@/lib/queries/client-requests";
import { inboxBadgeCount } from "@/lib/inbox/inbox-badge-count";
import { getVisibleInboxTabs } from "@/lib/inbox/visible-tabs";
import { Badge } from "@/components/ui/badge";

export async function InboxBadgeFigure({
  workspaceId,
  isClient,
}: {
  workspaceId: string;
  isClient: boolean;
}) {
  // F060 (SB-054): approvals/requests only contribute when those tabs are
  // actually in the caller's visible-tabs list -- the exact same rule the
  // Inbox page itself uses to decide which tabs to render.
  const visibleTabs = getVisibleInboxTabs(isClient);
  const approvalsRequestsGated = !visibleTabs.includes("approvals");

  // F054 (FU-M4-7, SB-054): each query fails open (never rejects) and
  // reports failure through its own typed `error` field -- run them in
  // parallel with `Promise.all` (safe: none of them can reject) and
  // reconcile from those `error` fields, not from settlement status.
  const [notifications, approvals, requests] = await Promise.all([
    getNotificationsForWorkspace(workspaceId),
    approvalsRequestsGated
      ? Promise.resolve<{ count: number; error?: string }>({ count: 0 })
      : getOpenApprovalCountForWorkspace(workspaceId),
    approvalsRequestsGated
      ? Promise.resolve<{ count: number; error?: string }>({ count: 0 })
      : getOpenClientRequestCountForWorkspace(workspaceId),
  ]);

  const reconcileFailed = Boolean(
    notifications.error || approvals.error || requests.error,
  );

  const unreadNotifications = notifications.unreadCount;
  const pendingApprovals = approvals.count;
  const openRequests = requests.count;

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
