import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import { getProjectMetricsWithLatestSnapshot, getProjectImprovements } from "@/lib/queries/metrics";
import { MeasurementPanel } from "@/components/project/measurement-panel";
import { ProjectSettingsNav } from "@/components/project/project-settings-nav";
import { Separator } from "@/components/ui/separator";

// F020 (missions/20260903-portal): project settings "Measurement" panel
// (AS-039, AS-040, AS-041). Mirrors settings/deliverables/page.tsx exactly
// in structure and chrome — a tab beside the other settings sub-nav
// entries, reached through the same ProjectSettingsNav.
//
// Server Component for data loading — metrics (each with its latest
// snapshot), improvements, and the project's own baseline-frozen state
// are server-fetched and passed down as typed props; the only Client
// Component is components/project/measurement-panel.tsx.
export default async function ProjectMeasurementSettingsPage({
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
    .select("id, workspace_id, name, baseline_frozen_at")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [{ data: ownWorkspaceMembership }, metricsResult, improvementsResult] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    getProjectMetricsWithLatestSnapshot(project.id),
    getProjectImprovements(project.id),
  ]);

  const workspaceRole = (ownWorkspaceMembership?.role ?? "guest") as WorkspaceRole;
  const canManage = canWrite({ role: workspaceRole });

  const metrics = metricsResult.ok ? metricsResult.data : [];
  const improvements = improvementsResult.ok ? improvementsResult.data : [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Measurement</h1>
        <p className="text-sm text-muted-foreground">
          {project.name}&apos;s results metrics, baseline, and before/after
          improvements — what F021&apos;s portal Results view shows the
          client.
        </p>
      </div>

      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={project.id} />

      <Separator />

      <MeasurementPanel
        projectId={project.id}
        initialMetrics={metrics}
        initialImprovements={improvements}
        baselineFrozenAt={project.baseline_frozen_at}
        canManage={canManage}
      />
    </div>
  );
}
