import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import {
  getProjectAssumptions,
  getProjectDecisions,
  getProjectScopeItems,
} from "@/lib/queries/project-records";
import { RecordPanel } from "@/components/project/record-panel";
import { ProjectSettingsNav } from "@/components/project/project-settings-nav";
import { Separator } from "@/components/ui/separator";

// F015 (missions/20260903-portal, AS-043, AS-044, AS-045, AS-046): project
// settings "Record" panel — scope, decisions, assumptions. Mirrors
// settings/deliverables/page.tsx exactly in structure: Server Component
// for data loading (all three lists fetched in parallel and passed down
// as typed props), the only Client Component is
// components/project/record-panel.tsx.
export default async function ProjectRecordSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    { data: workspace },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("workspaces").select("id, name").eq("slug", workspaceSlug).maybeSingle(),
  ]);

  if (!user) {
    redirect("/sign-in");
  }

  if (!workspace) {
    redirect("/onboarding");
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, workspace_id, name")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [{ data: ownWorkspaceMembership }, scopeResult, decisionsResult, assumptionsResult] =
    await Promise.all([
      supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
      getProjectScopeItems(project.id),
      getProjectDecisions(project.id),
      getProjectAssumptions(project.id),
    ]);

  const workspaceRole = (ownWorkspaceMembership?.role ?? "guest") as WorkspaceRole;
  const canManage = canWrite({ role: workspaceRole });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Record</h1>
        <p className="text-sm text-muted-foreground">
          {project.name}&rsquo;s scope, the decisions made along the way, and
          the assumptions the plan depends on.
        </p>
      </div>

      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={project.id} />

      <Separator />

      <RecordPanel
        projectId={project.id}
        workspaceSlug={workspaceSlug}
        initialScopeItems={scopeResult.ok ? scopeResult.data : []}
        initialDecisions={decisionsResult.ok ? decisionsResult.data : []}
        initialAssumptions={assumptionsResult.ok ? assumptionsResult.data : []}
        canManage={canManage}
      />
    </div>
  );
}
