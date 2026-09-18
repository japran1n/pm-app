import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";

import { getPortalProjects, getWorkspaceRoleForCurrentUser } from "@/lib/queries/portal";
import {
  getProjectAssumptions,
  getProjectChangeRequests,
  getProjectDecisions,
  getProjectScopeItems,
} from "@/lib/queries/project-records";
import { getProjectScopeDocuments } from "@/lib/queries/project-scope-documents";
import { getCurrentUser } from "@/lib/auth/current-user";
import { EmptyState } from "@/components/empty-state";
import { ScopeLists } from "@/components/portal/scope-lists";
import { ChangeRequestsTable } from "@/components/portal/change-requests-table";
import { DecisionLog } from "@/components/portal/decision-log";
import { AssumptionList } from "@/components/portal/assumption-list";
import { ScopeDocuments } from "@/components/portal/scope-documents";
import { Separator } from "@/components/ui/separator";

// F015 (missions/20260903-portal, AS-043, AS-044, AS-045, AS-046): the
// Scope view — replaces F003's `PortalComingSoon` stub. Same "re-resolve
// the project via getPortalProjects, don't trust the URL alone"
// convention every sibling route under this layout already follows (see
// e.g. your-list/page.tsx's own comment).
//
// A `client_visible = false` decision/assumption never reaches this
// page at all — RLS excludes it before either query fetches it (AS-045),
// so there is no client-side filter to get wrong here.
export default async function PortalScopePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const { supabase, user } = await getCurrentUser();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const projects = await getPortalProjects(workspace.id);
  const project = projects.find((p) => p.id === projectId);

  if (!project) notFound();

  const [scopeResult, decisionsResult, assumptionsResult, changeRequestsResult, documentsResult, role] =
    await Promise.all([
      getProjectScopeItems(projectId),
      getProjectDecisions(projectId),
      getProjectAssumptions(projectId),
      getProjectChangeRequests(projectId),
      getProjectScopeDocuments(projectId),
      user ? getWorkspaceRoleForCurrentUser(workspace.id, user.id) : Promise.resolve(null),
    ]);

  // A team member (any role other than 'client') may attach/remove
  // documents from this page; a client caller only ever sees the
  // read-only list — RLS (project_scope_documents_insert_team,
  // 20261106010000) enforces the same rule server-side regardless of
  // what this flag renders.
  const canManageDocuments = role !== null && role !== "client";

  if (
    !scopeResult.ok ||
    !decisionsResult.ok ||
    !assumptionsResult.ok ||
    !changeRequestsResult.ok ||
    !documentsResult.ok
  ) {
    return (
      <EmptyState
        icon={ScrollText}
        title="We couldn't load your scope."
        description="Something went wrong loading this project's scope and decisions. Try refreshing the page."
        testId="scope-error"
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <ScopeLists items={scopeResult.data} />

      <Separator />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Change requests</h2>
        <ChangeRequestsTable
          requests={changeRequestsResult.data}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Decision log</h2>
        <DecisionLog decisions={decisionsResult.data} />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Assumptions</h2>
        <AssumptionList assumptions={assumptionsResult.data} />
      </div>

      <Separator />

      <ScopeDocuments
        projectId={projectId}
        documents={documentsResult.data}
        canManage={canManageDocuments}
      />
    </div>
  );
}
