import { permanentRedirect } from "next/navigation";

// F012 (SB-045, SB-046): the standalone Archive page's content moved into
// the Projects page as an `?filter=archived` view (see
// app/(workspace)/w/[workspaceSlug]/projects/page.tsx). This route stays
// live (F003's AccountMenu-only entry point, and any old bookmarks/links)
// but now only redirects to the canonical URL — a server-side redirect,
// not a client navigation, so there is no flash of this page's old content
// and no client bundle is shipped for it.
//
// FU-20 (M3 scrutiny attempt 2): this route's target URL is permanent, not
// conditional on anything request-specific (no auth/role branching, no A/B
// variant) — the old `/archive` path has moved to
// `/projects?filter=archived` for good, matching the header comment above.
// `permanentRedirect()` sends a 308 instead of `redirect()`'s 307, letting
// browsers and any crawler/bookmark-following client cache the redirect
// rather than re-requesting this route on every visit. This route has no
// loading.tsx/error.tsx of its own (deleted alongside this change) since it
// never renders anything — it only ever redirects.
export default async function ArchivePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  permanentRedirect(`/w/${workspaceSlug}/projects?filter=archived`);
}
