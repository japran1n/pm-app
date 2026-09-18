import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getOpenApprovalsForWorkspace, getDecisionOwnerNames } from "@/lib/queries/approvals";
import { ApprovalsQueue, type ApprovalsQueueRow } from "@/components/approvals/approvals-queue";

// F010 (missions/20260903-portal, AS-027): the team-wide approvals queue
// — every open (`state = 'pending'`) approval across every project of
// this workspace, oldest-waiting first. See this feature's own spec
// header ("Why this one matters more than it looks") — with email out of
// scope for this mission, this screen is the entire escalation mechanism
// left: nothing pushes a stalled request to a client, so a PM has to
// notice it here and chase it themselves (Copy link, not a fake
// "Remind" send).
//
// Access: a `client` role never reaches this route at all — the parent
// `WorkspaceLayout` (app/(workspace)/w/[workspaceSlug]/layout.tsx)
// already redirects `role === "client"` straight to `/portal/[slug]`
// before any child route (including this one) renders, so this page adds
// no redundant role check of its own, matching the layout's own "C3: a
// client belongs in the portal, not here" comment. `getOpenApprovalsForWorkspace`
// reads through the ordinary RLS-respecting client
// (`approval_requests_select_team`), which is the actual access boundary
// for which PROJECTS' approvals a given team member sees.
export default async function ApprovalsQueuePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // Defensive fallback only — the layout guard one level up already
  // redirects away when the workspace can't be resolved for this caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  const approvals = await getOpenApprovalsForWorkspace(workspace.id);

  const ownerNames = await getDecisionOwnerNames(
    approvals.map((a) => ({ projectId: a.projectId, decisionType: a.decisionType })),
  );

  const rows: ApprovalsQueueRow[] = approvals.map((a) => ({
    ...a,
    decisionOwnerName: ownerNames.get(`${a.projectId}:${a.decisionType}`) ?? null,
  }));

  return (
    <div className="flex flex-col gap-4 p-6 pt-4 lg:p-8 lg:pt-8">
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <ApprovalsQueue workspaceSlug={workspaceSlug} approvals={rows} />
    </div>
  );
}
