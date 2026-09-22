import { permanentRedirect } from "next/navigation";

import { legacyInboxRedirectPath } from "@/lib/inbox/legacy-redirect";

// F015 (SB-056): the standalone Approvals queue merged into the Inbox's
// "Approvals" tab (F013). This route stays live for old bookmarks/links
// (e.g. components/brief/brief-approval-status.tsx's "View in approvals"
// link, and any Needs-you card actionHref still pointing here) but now
// only redirects to the canonical `/w/<slug>/inbox?tab=approvals` URL —
// same "permanent, not conditional on anything request-specific"
// rationale as the Archive route's own F047/F012 precedent
// (app/(workspace)/w/[workspaceSlug]/archive/page.tsx): the old
// `/approvals` path has moved to the Inbox tab for good, so a 308 lets
// browsers/crawlers cache the redirect instead of re-requesting this
// route every visit. loading.tsx/error.tsx deleted alongside this change
// since this route never renders anything anymore.
export default async function ApprovalsRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  permanentRedirect(
    legacyInboxRedirectPath(workspaceSlug, "approvals", resolvedSearchParams),
  );
}
