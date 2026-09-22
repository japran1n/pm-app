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
  const requests = await getWorkspaceClientRequests(workspaceId);

  return <TeamRequestInbox requests={requests} workspaceSlug={workspaceSlug} />;
}
