import { notFound } from "next/navigation";
import Link from "next/link";

import { getWorkspaceBySlug } from "@/lib/queries/workspaces";
import { getProjectById } from "@/lib/queries/projects";
import {
  getProjectEstimateAndLoggedByPerson,
  getProjectTimeTotals,
} from "@/lib/queries/time-entries";
import { resolvePeople } from "@/lib/queries/people";
import { getProjectLinks } from "@/lib/queries/project-site";
import { PersonEstimateRollup } from "@/components/project/person-estimate-rollup";
import { ProjectTabs } from "@/components/project-tabs";
import { ProjectBreadcrumb } from "@/components/project/project-breadcrumb";
import { ProjectLinkStrip } from "@/components/project/project-link-strip";
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

  // Parent workspace layout already verified auth and active membership —
  // no redundant getUser() needed here. The workspace lookup is still
  // required because this layout needs workspace.id for getProjectById.
  const workspace = await getWorkspaceBySlug(workspaceSlug);

  if (!workspace) {
    notFound();
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
  // F168 (AS-303): the same RPC also returns the project's summed task
  // estimate, rendered alongside the logged total. AS-304 (excluding a
  // soft-deleted task's estimate) is likewise enforced inside the RPC.
  // timeTotals and personRollup are independent of each other — run in
  // parallel (P4: eliminates one serial round-trip per project page load).
  // Internal "quick links" strip (Figma/staging/live/etc): fetched
  // alongside the other independent per-project reads already made here.
  // Unfiltered by client_visible (getProjectLinks, not
  // getClientVisiblePortalLinks) -- this is the team's own surface, so a
  // link the team hasn't yet marked client-visible should still be one
  // click away for the team itself.
  const [timeTotals, personRollup, linksResult] = await Promise.all([
    getProjectTimeTotals(project.id),
    getProjectEstimateAndLoggedByPerson(project.id),
    getProjectLinks(project.id),
  ]);
  const projectLinks = linksResult.ok ? linksResult.data : [];
  const totalMinutes =
    timeTotals.billableMinutes + timeTotals.nonBillableMinutes;
  // F414: per-person rollup display names — depends on personRollup, so serial.
  const personNames = await resolvePeople(
    personRollup.map((row) => row.userId),
  );
  const formatHours = (minutes: number) => {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  };

  return (
    <div className="flex flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <ProjectBreadcrumb
        workspaceSlug={workspaceSlug}
        projectId={project.id}
        projectName={project.name}
      />
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

        {(totalMinutes > 0 || timeTotals.estimateMinutes > 0) && (
          <div className="flex flex-col gap-1.5">
            <p className="font-mono text-sm text-muted-foreground">
              {formatHours(totalMinutes)}h logged (
              {formatHours(timeTotals.billableMinutes)}h billable)
              {timeTotals.estimateMinutes > 0 &&
                ` of ${formatHours(timeTotals.estimateMinutes)}h estimated`}
            </p>
            {/* F413: a bar alongside the existing text line — the number
                alone requires doing the division in your head to see
                whether a project is over. Only rendered once there is an
                estimate to measure against; a bar with nothing to compare
                to would just be a full-width bar for every project. */}
            {timeTotals.estimateMinutes > 0 && (
              <div
                className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${formatHours(totalMinutes)} of ${formatHours(timeTotals.estimateMinutes)} hours estimated logged`}
              >
                <div
                  className={
                    totalMinutes > timeTotals.estimateMinutes
                      ? "h-full bg-destructive"
                      : "h-full bg-primary"
                  }
                  style={{
                    width: `${Math.min(
                      100,
                      (totalMinutes / timeTotals.estimateMinutes) * 100,
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {personRollup.length > 0 && (
          <PersonEstimateRollup rows={personRollup} names={personNames} />
        )}

        <ProjectLinkStrip links={projectLinks} />

        <Separator />

        <ProjectTabs workspaceSlug={workspaceSlug} projectId={project.id} />
      </div>

      {children}
    </div>
  );
}
