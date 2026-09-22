import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getCurrentUser } from "@/lib/auth/current-user";
import { NotificationsTabContent } from "@/components/notifications/notifications-tab-content";
import { ApprovalsTabContent } from "@/components/approvals/approvals-tab-content";
import { RequestsTabContent } from "@/components/client-requests/requests-tab-content";
import { WatchingTabContent } from "@/components/watching/watching-tab-content";
import { AllTabContent } from "@/components/inbox/all-tab-content";
import { InboxTabNav, type InboxTabKey } from "@/components/inbox/inbox-tab-nav";
import { getVisibleInboxTabs } from "@/lib/inbox/visible-tabs";

// F013 (SB-050, SB-051, SB-052): the Inbox — a single page with five
// Link-based tabs (`?tab=`), each rendering the SAME list-rendering
// component the old standalone page for that tab already used (see each
// *-tab-content.tsx's own header comment). "All" (the default, no `?tab=`)
// merges every source newest-first, capped at 50 (components/inbox/
// all-tab-content.tsx).
//
// This feature does not yet change what the old standalone pages
// (notifications/approvals/requests/watching) render when visited
// directly — that's F015 (legacy redirects). Both this page and those
// still-live pages call the exact same tab-content components, so there is
// exactly one copy of each list's rendering logic, never two.
//
// Access: this route lives under /w/[workspaceSlug]/*, so the workspace
// layout above it has already redirected a `client` role to /portal/* and
// verified an active membership -- same convention every other page here
// follows, no redundant check of its own beyond resolving the caller's
// role for tab visibility (SB-052).
const VALID_TABS: InboxTabKey[] = ["all", "notifications", "approvals", "requests", "watching"];

function parseTab(raw: string | string[] | undefined): InboxTabKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && (VALID_TABS as string[]).includes(value)) {
    return value as InboxTabKey;
  }
  return "all";
}

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { workspaceSlug } = await params;
  const { tab: rawTab } = await searchParams;

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // Defensive fallback only — the layout guard one level up already
  // redirects away when the workspace can't be resolved for this caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  // SB-052: Approvals/Requests tabs hidden for roles denied those pages —
  // same "guest" gate the sidebar's own `guestExcluded` set already applies
  // to the "Client requests"/"Approvals" nav items (components/nav/
  // app-sidebar.tsx). A `client` role never reaches this far (workspace
  // layout redirect above).
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const isGuest = (membership?.role ?? "guest") === "guest";
  const canSeeApprovals = !isGuest;
  const canSeeRequests = !isGuest;

  const visibleTabs: InboxTabKey[] = getVisibleInboxTabs(isGuest);

  const requestedTab = parseTab(rawTab);
  const activeTab = visibleTabs.includes(requestedTab) ? requestedTab : "all";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6 pt-4 lg:p-8 lg:pt-8">
      <h1 className="text-xl font-semibold">Inbox</h1>
      <InboxTabNav
        workspaceSlug={workspaceSlug}
        activeTab={activeTab}
        visibleTabs={visibleTabs}
      />
      <Suspense fallback={null}>
        {activeTab === "all" && (
          <AllTabContent
            workspaceSlug={workspaceSlug}
            workspaceId={workspace.id}
            userId={user.id}
            canSeeApprovals={canSeeApprovals}
            canSeeRequests={canSeeRequests}
          />
        )}
        {activeTab === "notifications" && (
          <NotificationsTabContent workspaceSlug={workspaceSlug} workspaceId={workspace.id} />
        )}
        {activeTab === "approvals" && canSeeApprovals && (
          <ApprovalsTabContent workspaceSlug={workspaceSlug} workspaceId={workspace.id} />
        )}
        {activeTab === "requests" && canSeeRequests && (
          <RequestsTabContent workspaceSlug={workspaceSlug} workspaceId={workspace.id} />
        )}
        {activeTab === "watching" && (
          <WatchingTabContent workspaceSlug={workspaceSlug} userId={user.id} />
        )}
      </Suspense>
    </div>
  );
}
