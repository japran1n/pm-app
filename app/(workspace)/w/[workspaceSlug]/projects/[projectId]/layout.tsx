import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/queries/projects";
import { getProjectTimeTotals } from "@/lib/queries/time-entries";
import { ProjectTabs } from "@/components/project-tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// F030 (AS-038): project detail layout — resolves the project scoped to
// the active workspace, renders a header (name/description, plus an
// "Archived" indicator per F029/AS-032) and the Board/List tab switcher,
// then renders whichever tab route (board/page.tsx or list/page.tsx) is
// active as `children`.
//
// Server Component (clarified spec: "Server Component for data-fetching,
// thin Client Component only for the interactive part") — the only client
// boundary is ProjectTabs, which just wires the tab switcher to real
// navigation. Header content is server-rendered in the initial HTML
// (AS-155).
//
// Access: relies on the workspace-membership layout guard above this route
// (app/(workspace)/w/[workspaceSlug]/layout.tsx, F010/F023) — reaching
// this layout at all already means the caller is an active member of this
// workspace. No duplicate page-level gate, per the clarified spec, since
// AS-038 doesn't call for role-gating beyond membership.
//
// Works for both active and archived projects (per F029/AS-032, and this
// feature's own spec): `getProjectById` (lib/queries/projects.ts)
// deliberately bypasses the RLS SELECT policy's `deleted_at IS NULL`
// filter via the admin client, so an archived project's detail page
// renders normally instead of 404ing — AS-032 requires the row's data stay
// fully intact and readable, and this is the first UI surface that reads a
// project by id directly rather than through the always-filtered list
// query.
export default async function ProjectDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  // RLS-backed lookup (`workspaces_select_active_members`) — a null result
  // here means either the workspace doesn't exist or the caller isn't an
  // active member, both of which the layout guard above already redirects
  // away from; this is a defensive fallback only.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    redirect("/onboarding");
  }

  const project = await getProjectById(workspace.id, projectId);

  // F031 (AS-039, AS-040): a projectId that doesn't exist / was purged
  // (AS-039), or that is real but belongs to a DIFFERENT workspace than
  // `workspaceSlug` (AS-040), both collapse to `getProjectById` returning
  // `null` (it filters `.eq("workspace_id", workspace.id)` even though it
  // reads via the admin client) — so both cases hit the exact same
  // `notFound()` branch below. Not distinguishing "doesn't exist" from
  // "wrong workspace" avoids leaking cross-workspace project existence to
  // an active member of a different workspace, mirroring the workspace
  // layout's own AS-144 rationale one level down.
  if (!project) {
    notFound();
  }

  const isArchived = Boolean(project.deletedAt);

  // F114 (AS-172): total logged time, split into billable/non-billable,
  // rendered as a small stat in the project header. AS-174 (excluding a
  // soft-deleted task's time) is enforced inside the RPC itself
  // (get_project_time_totals), not here.
  const timeTotals = await getProjectTimeTotals(project.id);
  const totalMinutes =
    timeTotals.billableMinutes + timeTotals.nonBillableMinutes;
  const formatHours = (minutes: number) => {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  };

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {project.name}
              </h1>
              {isArchived && <Badge variant="outline">Archived</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {project.description || "No description."}
            </p>
          </div>
          <Link
            href={`/w/${workspaceSlug}/projects`}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Back to projects
          </Link>
        </div>

        {totalMinutes > 0 && (
          <p className="text-sm text-muted-foreground">
            {formatHours(totalMinutes)}h logged (
            {formatHours(timeTotals.billableMinutes)}h billable)
          </p>
        )}

        <Separator />

        <ProjectTabs workspaceSlug={workspaceSlug} projectId={project.id} />
      </div>

      {children}
    </div>
  );
}
