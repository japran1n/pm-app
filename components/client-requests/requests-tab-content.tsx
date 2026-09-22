import { getWorkspaceClientRequests } from "@/lib/queries/client-requests";
import { TeamRequestInbox } from "@/components/client-requests/team-request-inbox";

// F013: server-fetch wrapper reused by the Inbox "Requests" tab and by
// app/(workspace)/w/[workspaceSlug]/requests/page.tsx (F015 will make that
// page redirect here, not yet). Behaviour-identical to the old page's body.
export async function RequestsTabContent({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string;
  workspaceId: string;
}) {
  const { list: requests, error } = await getWorkspaceClientRequests(workspaceId);

  // F050 (FU-M4-3): a real fetch failure must never render the same
  // "no requests" empty state a legitimate zero-row result would — throw
  // so app/(workspace)/w/[workspaceSlug]/inbox/error.tsx (and this route's
  // own error.tsx) renders an error affordance instead.
  if (error) {
    throw new Error(error);
  }

  return <TeamRequestInbox requests={requests} workspaceSlug={workspaceSlug} />;
}
