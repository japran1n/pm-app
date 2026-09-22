import type { InboxTabKey } from "@/components/inbox/inbox-tab-nav";

// F049 (FU-M4-2, SB-052): pure, unit-testable tab-visibility rule for the
// Inbox, keyed off the ACTUAL server-side access rule the old standalone
// `/approvals` and `/requests` pages enforced (see their own pre-F013
// history and file-header comments, e.g. commit 52322272 / 4cab6033):
// neither page performed any role check of its own beyond the workspace
// layout's redirect of `role === "client"` to `/portal/*`. A guest was
// never blocked from either page — that exclusion existed only in the
// sidebar's cosmetic `guestExcluded` set (components/nav/app-sidebar.tsx),
// which gates nav *entries*, not page access, and was wrongly copied here
// by F013.
//
// So the real predicate is "is this caller a client", not "is this caller
// a guest". A `client` role never reaches this function in practice —
// the workspace layout already redirects it away before the Inbox page
// renders — but the parameter is named for the real rule so a future
// caller (or a defensive check here) can't silently reintroduce the guest
// exclusion.
export function getVisibleInboxTabs(isClient: boolean): InboxTabKey[] {
  return [
    "all",
    "notifications",
    ...(isClient ? [] : (["approvals"] as const)),
    ...(isClient ? [] : (["requests"] as const)),
    "watching",
  ];
}
