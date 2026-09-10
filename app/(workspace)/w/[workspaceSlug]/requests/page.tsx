import { notFound } from "next/navigation";

import { getWorkspaceClientRequests } from "@/lib/queries/client-requests";
import { createClient } from "@/lib/supabase/server";
import { TeamRequestInbox } from "@/components/client-requests/team-request-inbox";

// C5/C6 team side: the client-request inbox.
//
// Lives under /w/* like every other team page, which also means the
// workspace layout's client redirect already keeps clients out of it —
// no second guard needed here, and none that could drift from the first.
export default async function ClientRequestsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const requests = await getWorkspaceClientRequests(workspace.id);

  return (
    <div className="flex flex-col gap-8 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Client requests
        </h1>
        <p className="text-sm text-muted-foreground">
          What your clients have asked for. Accepting one creates a task and
          shares it back with them.
        </p>
      </div>

      <TeamRequestInbox requests={requests} workspaceSlug={workspace.slug} />
    </div>
  );
}
