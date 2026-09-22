import type { InboxTabKey } from "@/components/inbox/inbox-tab-nav";

// F013 (SB-052): pure, unit-testable tab-visibility rule for the Inbox —
// Approvals/Requests are hidden for any role that could not reach those
// standalone pages either. Matches the sidebar's own `guestExcluded` gate
// (components/nav/app-sidebar.tsx) for "Approvals"/"Client requests": a
// guest never sees an entry point to either, same rule applied here to the
// Inbox tabs instead of two separate nav items. A `client` role never
// reaches this far — the workspace layout redirects it to `/portal/*`
// before any Inbox render.
export function getVisibleInboxTabs(isGuest: boolean): InboxTabKey[] {
  return [
    "all",
    "notifications",
    ...(isGuest ? [] : (["approvals"] as const)),
    ...(isGuest ? [] : (["requests"] as const)),
    "watching",
  ];
}
