import { permanentRedirect } from "next/navigation";

import { legacyInboxRedirectPath } from "@/lib/inbox/legacy-redirect";

// F015 (SB-056): the standalone Notifications page merged into the
// Inbox's "Notifications" tab (F013). This route stays live for old
// bookmarks/links (e.g. components/dashboard/needs-you-card.tsx's "Inbox"
// link, and the dashboard's Needs-you actionHref) but now only redirects
// to the canonical `/w/<slug>/inbox?tab=notifications` URL — same
// permanent-redirect rationale as the Archive route's own F047/F012
// precedent (app/(workspace)/w/[workspaceSlug]/archive/page.tsx).
// loading.tsx/error.tsx deleted alongside this change since this route
// never renders anything anymore.
export default async function NotificationsRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  permanentRedirect(
    legacyInboxRedirectPath(
      workspaceSlug,
      "notifications",
      resolvedSearchParams,
    ),
  );
}
