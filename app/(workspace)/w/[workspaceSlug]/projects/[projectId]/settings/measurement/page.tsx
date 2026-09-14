import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canWrite} from "@/lib/auth/permissions";
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

  // ARCH-001: caller identity, the workspace-by-slug lookup, and the
  // caller's own membership role all come from the shared cached helper
  // (lib/queries/workspaces.ts) instead of three per-page queries.
  const ctx = await getWorkspaceContext(workspaceSlug);

  if (!ctx.user) {
    redirect("/sign-in");
  }

  if (!ctx.workspace) {
    redirect("/onboarding");
  }

  const { workspace, role: workspaceRole } = ctx;

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

  const [metricsResult, improvementsResult] = await Promise.all([
    getProjectMetricsWithLatestSnapshot(project.id),
    getProjectImprovements(project.id),
  ]);

  const canManage = canWrite({ role: workspaceRole });

  const metrics = metricsResult.ok ? metricsResult.data : [];
  const improvements = improvementsResult.ok ? improvementsResult.data : [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Measurement</h1>
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
