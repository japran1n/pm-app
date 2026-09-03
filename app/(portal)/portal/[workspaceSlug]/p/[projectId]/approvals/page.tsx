import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import {
  getApprovalHistory,
  getDecisionOwners,
  getOpenApprovalsForClient,
} from "@/lib/queries/approvals";
import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { ApprovalCard } from "@/components/portal/approval-card";
import { ApprovalHistory } from "@/components/portal/approval-history";
import { DecisionOwnersGrid } from "@/components/portal/decision-owners-grid";
import { EmptyState } from "@/components/empty-state";

// F009 (missions/20260903-portal, AS-021, AS-022, AS-023, AS-026):
// replaces the `PortalComingSoon` stub. Three sections, in the order the
// spec's own scope lists them: open approvals (what needs a decision
// right now), decision history (the record of what was decided, worth
// more than the open list per this feature's own scope note), and "who
// approves what" (project_decision_owners, so a client can see who to
// chase if a decision is stuck on a teammate).
//
// Project resolution reuses `getPortalProjects`, same pattern as every
// other route under this project-scoped shell (p/[projectId]/page.tsx,
// p/[projectId]/layout.tsx) -- one visibility path, not a second,
// independent lookup this route could disagree with.
export default async function PortalApprovalsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const projects = await getPortalProjects(workspace.id);
  const project = projects.find((p) => p.id === projectId);

  if (!project) notFound();

  const [openApprovals, history, owners] = await Promise.all([
    getOpenApprovalsForClient(project.id),
    getApprovalHistory(project.id),
    getDecisionOwners(project.id),
  ]);

  // AS-022: which decision types THIS signed-in client owns, so each
  // card's Approve/Request changes buttons render enabled only for the
  // requests they can actually decide -- presentation only, the RPC
  // (decide_approval_atomic) is the real control regardless of what this
  // computes.
  const ownerByType = new Map(owners.map((owner) => [owner.decisionType, owner]));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Open approvals</h2>
        {openApprovals.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing waiting on you"
            description="Approval requests raised by the team will show up here."
            testId="open-approvals-empty"
          />
        ) : (
          <div className="flex flex-col gap-4">
            {openApprovals.map((approval) => {
              const owner = ownerByType.get(approval.decisionType);
              return (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  workspaceSlug={workspace.slug}
                  projectId={project.id}
                  isOwner={owner?.userId === user?.id}
                  ownerName={owner?.name ?? null}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Decision history</h2>
        <ApprovalHistory entries={history} />
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Who approves what</h2>
        <DecisionOwnersGrid owners={owners} />
      </div>
    </div>
  );
}
