// F016 (AS-017): the "Approvals" nav item's own async server component.
// Fetches its own count (F014's `getOpenApprovalCountForWorkspace`) rather
// than the layout awaiting it as part of the big `Promise.all` -- the
// layout wraps this in its own `<Suspense fallback={null}>` and passes the
// resolved node down as AppSidebar's `approvalsBadge` slot. Renders the
// exact same badge markup `app-sidebar.tsx` used to render inline from a
// `count` number (0/undefined -> nothing, so a settled workspace's nav
// item looks exactly like before).
import { getOpenApprovalCountForWorkspace } from "@/lib/queries/approvals";
import { Badge } from "@/components/ui/badge";

export async function ApprovalsBadgeFigure({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const count = await getOpenApprovalCountForWorkspace(workspaceId);

  if (!(typeof count === "number" && count > 0)) {
    return null;
  }

  return (
    <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px] font-mono">
      {count}
    </Badge>
  );
}
