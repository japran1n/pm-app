import { permanentRedirect } from "next/navigation";

import { legacyInboxRedirectPath } from "@/lib/inbox/legacy-redirect";

// F015 (SB-056): the standalone client-request inbox merged into the
// Inbox's "Requests" tab (F013). This route stays live for old
// bookmarks/links but now only redirects to the canonical
// `/w/<slug>/inbox?tab=requests` URL — same permanent-redirect rationale
// as the Archive route's own F047/F012 precedent
// (app/(workspace)/w/[workspaceSlug]/archive/page.tsx). loading.tsx/
// error.tsx deleted alongside this change since this route never renders
// anything anymore.
export default async function RequestsRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  permanentRedirect(
    legacyInboxRedirectPath(workspaceSlug, "requests", resolvedSearchParams),
  );
}
