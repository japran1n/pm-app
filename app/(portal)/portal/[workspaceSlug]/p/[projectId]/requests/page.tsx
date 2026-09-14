import { redirect } from "next/navigation";

// Mission 20260914-portal-simplify, F009 (AS-017): "Requests" was folded
// into the new "Messages" page (F007) -- filing a request is now a
// checkbox on the Messages composer, and a client's own requests render
// in a "Your requests" section on that same page. This route stays live
// -- as a redirect only -- so old bookmarks, emails, and notification
// links keep working. Same "layout already guards this" reasoning as the
// sibling `approvals/page.tsx` redirect -- see that file's own comment.
export default async function LegacyPortalProjectRequestsRedirect({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  redirect(`/portal/${workspaceSlug}/p/${projectId}/conversation`);
}
