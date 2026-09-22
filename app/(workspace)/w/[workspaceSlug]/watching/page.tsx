import { permanentRedirect } from "next/navigation";

import { legacyInboxRedirectPath } from "@/lib/inbox/legacy-redirect";

// F015 (SB-056): the standalone Watching feed merged into the Inbox's
// "Watching" tab (F013). This route stays live for old bookmarks/links
// but now only redirects to the canonical `/w/<slug>/inbox?tab=watching`
// URL — same permanent-redirect rationale as the Archive route's own
// F047/F012 precedent (app/(workspace)/w/[workspaceSlug]/archive/page.tsx).
// This route never had its own loading.tsx/error.tsx.
export default async function WatchingRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  permanentRedirect(
    legacyInboxRedirectPath(workspaceSlug, "watching", resolvedSearchParams),
  );
}
