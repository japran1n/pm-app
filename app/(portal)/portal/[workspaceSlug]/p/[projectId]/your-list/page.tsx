import { redirect } from "next/navigation";

// Mission 20260914-portal-simplify, F009 (AS-017): "Your list" was
// folded into the new "For you" page (F006) as its Materials half. This
// route stays live -- as a redirect only -- so old bookmarks, emails, and
// notification links keep working. Same "layout already guards this"
// reasoning as the sibling `approvals/page.tsx` redirect -- see that
// file's own comment.
export default async function LegacyPortalYourListRedirect({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  redirect(`/portal/${workspaceSlug}/p/${projectId}/for-you?filter=materials`);
}
