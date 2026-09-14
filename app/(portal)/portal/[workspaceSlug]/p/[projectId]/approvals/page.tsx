import { redirect } from "next/navigation";

// Mission 20260914-portal-simplify, F009 (AS-017): "Approvals" was
// folded into the new "For you" page (F006) as its Decisions half. This
// route stays live -- as a redirect only -- so old bookmarks, emails, and
// notification links keep working. No project/portal-enabled lookup is
// needed here: this page renders as a child of
// `p/[projectId]/layout.tsx`, which already 404s before this component
// ever mounts if the project doesn't exist, isn't shared with this
// client, or has `portal_enabled = false` (see that layout's own
// comment) -- the same guard every sibling route under this segment
// already relies on.
export default async function LegacyPortalApprovalsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{ approvalId?: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  // F013 (AS-017): a stale `?approvalId=` on this old URL (e.g. from a
  // link copied before this feature shipped) must keep pointing at the
  // same decision, not just at the decisions filter in general.
  const { approvalId } = await searchParams;

  const query = new URLSearchParams({ filter: "decisions" });
  if (approvalId) query.set("approvalId", approvalId);

  redirect(`/portal/${workspaceSlug}/p/${projectId}/for-you?${query.toString()}`);
}
