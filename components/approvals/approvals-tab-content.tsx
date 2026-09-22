import {
  getOpenApprovalsForWorkspace,
  getDecisionOwnerNames,
} from "@/lib/queries/approvals";
import { ApprovalsQueue, type ApprovalsQueueRow } from "@/components/approvals/approvals-queue";

// F013: server-fetch wrapper reused by the Inbox "Approvals" tab and by
// app/(workspace)/w/[workspaceSlug]/approvals/page.tsx (F015 will make that
// page redirect here, not yet). Behaviour-identical to the old page's body.
export async function ApprovalsTabContent({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string;
  workspaceId: string;
}) {
  const approvals = await getOpenApprovalsForWorkspace(workspaceId);

  const ownerNames = await getDecisionOwnerNames(
    approvals.map((a) => ({ projectId: a.projectId, decisionType: a.decisionType })),
  );

  const rows: ApprovalsQueueRow[] = approvals.map((a) => ({
    ...a,
    decisionOwnerName: ownerNames.get(`${a.projectId}:${a.decisionType}`) ?? null,
  }));

  return <ApprovalsQueue workspaceSlug={workspaceSlug} approvals={rows} />;
}
