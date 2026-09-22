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
  const { list: approvals, error } = await getOpenApprovalsForWorkspace(workspaceId);

  // F057 (FU-M4-10): a real fetch failure must never render the same
  // "nothing waiting" empty state a legitimate zero-row result would —
  // throw so app/(workspace)/w/[workspaceSlug]/inbox/error.tsx (and this
  // route's own error.tsx) renders an error affordance instead, matching
  // F050's convention on RequestsTabContent.
  if (error) {
    throw new Error(error);
  }

  const ownerNames = await getDecisionOwnerNames(
    approvals.map((a) => ({ projectId: a.projectId, decisionType: a.decisionType })),
  );

  const rows: ApprovalsQueueRow[] = approvals.map((a) => ({
    ...a,
    decisionOwnerName: ownerNames.get(`${a.projectId}:${a.decisionType}`) ?? null,
  }));

  return <ApprovalsQueue workspaceSlug={workspaceSlug} approvals={rows} />;
}
