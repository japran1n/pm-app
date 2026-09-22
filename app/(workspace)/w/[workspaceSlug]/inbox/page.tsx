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
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // Defensive fallback only — the layout guard one level up already
  // redirects away when the workspace can't be resolved for this caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  // F049 (FU-M4-2, SB-052): Approvals/Requests tabs hidden only for the
  // role the old standalone pages actually excluded — `client` (see
  // lib/inbox/visible-tabs.ts's own header comment for the git-history
  // evidence). A `client` role never reaches this far in practice (the
  // workspace layout above already redirects it to `/portal/*`); this
  // defensive re-check keeps the Inbox's own gate keyed to the same rule
  // rather than trusting the layout alone, and — unlike the F013 version —
  // no longer excludes guests, who the old pages never blocked.
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  // F050 (FU-M4-3): a transient DB error here used to fall through the
  // `?? "guest"` default below, silently hiding Approvals/Requests from an
  // owner/member as if they were a guest, with no signal anything went
  // wrong. Fail loudly instead — same "typed error surfaces, never
  // demoted to a lesser role" rule this fix applies to the tab content
  // below.
  if (membershipError) {
    throw new Error("Couldn't resolve your workspace role.");
  }

  const isClient = membership?.role === "client";
  const canSeeApprovals = !isClient;
  const canSeeRequests = !isClient;

  const visibleTabs: InboxTabKey[] = getVisibleInboxTabs(isClient);

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
          <RequestsTabContent workspaceSlug={workspace.slug} workspaceId={workspace.id} />
        )}
        {activeTab === "watching" && (
          <WatchingTabContent workspaceSlug={workspaceSlug} userId={user.id} />
        )}
      </Suspense>
    </div>
  );
}
