import { redirect } from "next/navigation";

// F012 (SB-045, SB-046): the standalone Archive page's content moved into
// the Projects page as an `?filter=archived` view (see
// app/(workspace)/w/[workspaceSlug]/projects/page.tsx). This route stays
// live (F003's AccountMenu-only entry point, and any old bookmarks/links)
// but now only redirects to the canonical URL — a server-side
// `redirect()`, not a client navigation, so there is no flash of this
// page's old content and no client bundle is shipped for it.
export default async function ArchivePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(`/w/${workspaceSlug}/projects?filter=archived`);
}
