import { notFound } from "next/navigation";

import { getPortalProjects, getPortalRequests } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { NewRequestForm } from "@/components/portal/new-request-form";
import { RequestList } from "@/components/portal/request-list";

// C5: the client's own request inbox — file a new one, and follow what
// happened to the ones already filed.
//
// F003b (missions/20260903-portal): relocated here, under the
// project-scoped shell.
//
// F079 (missions/20260903-portal audit, defect 2): this page used to call
// `getPortalRequests`/`getPortalProjectOptions` workspace-wide — a client
// on two projects saw the OTHER project's request history and could file
// a new request against it from a page whose URL and shell both say "you
// are inside one project". `getPortalRequests` itself stays workspace-wide
// (lib/queries/portal.ts is owned by a concurrent worker this feature must
// not touch) so the fix filters its result down to this route's own
// `projectId` here, the same "read stays wide, THIS caller narrows it"
// shape `p/[projectId]/page.tsx` already uses for `overview.
// deliveredThisWeek` (see that file's own comment). The project picker in
// `NewRequestForm` is dropped in favour of a fixed hidden field for the
// same reason — see that component's own `fixedProjectId` comment.
export default async function PortalRequestsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const [projects, allRequests] = await Promise.all([
    getPortalProjects(workspace.id),
    getPortalRequests(workspace.id),
  ]);

  const project = projects.find((p) => p.id === projectId);
  if (!project) notFound();

  const requests = allRequests.filter((request) => request.projectId === projectId);

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

      <NewRequestForm
        projects={[]}
        fixedProjectId={{ id: project.id, name: project.name }}
      />

      <RequestList requests={requests} projectId={project.id} />
    </div>
  );
}
