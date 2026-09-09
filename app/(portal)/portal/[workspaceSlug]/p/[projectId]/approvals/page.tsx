import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import {
  getApprovalHistory,
  getDecisionOwners,
  getProjectDecisionTypes,
  getOpenApprovalsForClient,
} from "@/lib/queries/approvals";
import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { ApprovalCard } from "@/components/portal/approval-card";
import { ApprovalHistory } from "@/components/portal/approval-history";
import { DecisionOwnersGrid } from "@/components/portal/decision-owners-grid";
import { EmptyState } from "@/components/empty-state";

// F009 (missions/20260903-portal, AS-021, AS-022, AS-023, AS-026):
// replaces the `PortalComingSoon` stub. Three sections: open approvals
// (what needs a decision right now), decision history (the record of
// what was decided), and "who approves what" (project_decision_owners,
// so a client can see who to chase if a decision is stuck on a
// teammate).
//
// Redesign (2026-09-07, user request): "who approves what" moved to the
// top of the page, above "Open approvals" -- a client orienting on this
// page benefits from seeing who owns each decision type before looking
// at what's currently open, and the compact `DecisionOwnersGrid` strip
// no longer costs enough vertical space to justify placing it last.
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

  const [openApprovalsResult, historyResult, ownersResult, decisionTypesResult] = await Promise.all([
    getOpenApprovalsForClient(project.id),
    getApprovalHistory(project.id),
    getDecisionOwners(project.id),
    getProjectDecisionTypes(project.id),
  ]);

  // F079 (missions/20260903-portal audit, defect 1): each of the three
  // reads above now reports a failed load as `{ ok: false }` instead of
  // silently coalescing to `[]` (see getOpenApprovalsForClient's own
  // header comment) -- a client who reads "nothing waiting on you" after
  // a database blip stops looking, and an overdue approval slips. Each
  // section fails on its own (an "Independently failable" contract, same
  // as this mission's own assertion-quality rule): a broken decision-
  // owners read never hides open approvals that DID load, and vice
  // versa. Same "Couldn't load" EmptyState convention results/page.tsx
  // uses for `getProjectMetricsWithLatestSnapshot`'s identical failure
  // shape.
  const owners = ownersResult.ok ? ownersResult.data : [];

  // AS-022: which decision types THIS signed-in client owns, so each
  // card's Approve/Request changes buttons render enabled only for the
  // requests they can actually decide -- presentation only, the RPC
  // (decide_approval_atomic) is the real control regardless of what this
  // computes.
  const ownerByType = new Map(owners.map((owner) => [owner.decisionType, owner]));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Who approves what
        </h2>
        {!ownersResult.ok || !decisionTypesResult.ok ? (
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't load decision owners"
            description="Something went wrong loading who approves what for this project. Try refreshing the page."
            testId="decision-owners-error"
          />
        ) : (
          <DecisionOwnersGrid decisionTypes={decisionTypesResult.data} owners={ownersResult.data} />
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Open approvals
        </h2>
        {!openApprovalsResult.ok ? (
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't load open approvals"
            description="Something went wrong loading this project's approvals. Try refreshing the page."
            testId="open-approvals-error"
          />
        ) : openApprovalsResult.data.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing waiting on you"
            description="Approval requests raised by the team will show up here."
            testId="open-approvals-empty"
          />
        ) : (
          <div className="flex flex-col gap-4">
            {openApprovalsResult.data.map((approval) => {
              const owner = ownerByType.get(approval.decisionType);
              return (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  workspaceSlug={workspace.slug}
                  projectId={project.id}
                  isOwner={owner?.userId === user?.id}
                  ownerName={owner?.name ?? null}
                  ownerId={owner?.userId ?? null}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Decision history
        </h2>
        {!historyResult.ok ? (
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't load decision history"
            description="Something went wrong loading this project's decision history. Try refreshing the page."
            testId="approval-history-error"
          />
        ) : (
          <ApprovalHistory entries={historyResult.data} />
        )}
      </div>
    </div>
  );
}
