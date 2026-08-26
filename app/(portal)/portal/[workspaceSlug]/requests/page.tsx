import { notFound } from "next/navigation";

import {
  getPortalProjectOptions,
  getPortalRequests,
} from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { NewRequestForm } from "@/components/portal/new-request-form";
import { RequestList } from "@/components/portal/request-list";

// C5: the client's own request inbox — file a new one, and follow what
// happened to the ones already filed.
export default async function PortalRequestsPage({
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

  const [projects, requests] = await Promise.all([
    getPortalProjectOptions(workspace.id),
    getPortalRequests(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your requests</h1>
        <p className="text-sm text-muted-foreground">
          Ask {workspace.name} for something. They will accept it — which puts
          it on the board where you can follow it — or come back to you with a
          reason.
        </p>
      </div>

      <NewRequestForm projects={projects} />

      <RequestList requests={requests} />
    </div>
  );
}
