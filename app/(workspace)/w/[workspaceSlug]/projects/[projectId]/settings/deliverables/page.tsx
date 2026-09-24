import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canTeamWrite } from "@/lib/auth/permissions";
import { getClientDeliverables } from "@/lib/queries/deliverables";
import { DeliverablesPanel } from "@/components/project/deliverables-panel";
import { ProjectSettingsNav } from "@/components/project/project-settings-nav";
import { Separator } from "@/components/ui/separator";

// F013 (missions/20260903-portal): project settings "What we need from
// the client" panel (AS-028). Mirrors settings/phases/page.tsx exactly in
// structure and chrome — a tab beside the phases settings, per this
// feature's own spec ("not buried in settings, because a PM edits this
// weekly rather than once"), reached through the same
// ProjectSettingsNav sub-nav phases/columns/members already use.
//
// Server Component for data loading — the deliverable list AND the
// project's own task list (for the "linked task" picker) are
// server-fetched and passed down as typed props; the only Client
// Component is components/project/deliverables-panel.tsx.
export default async function ProjectDeliverablesSettingsPage({
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
    .select("id, workspace_id, name")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [deliverablesResult, { data: taskRows }] =
    await Promise.all([
      getClientDeliverables(project.id),
      supabase
        .from("tasks")
        .select("id, title")
        .eq("project_id", project.id)
        .is("deleted_at", null)
        .order("title", { ascending: true }),
    ]);

  const canManage = canTeamWrite({ role: workspaceRole });

  const deliverables = deliverablesResult.ok ? deliverablesResult.data : [];
  const taskOptions = (taskRows ?? []).map((row) => ({ id: row.id, title: row.title }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Deliverables</h1>
        <p className="text-sm text-muted-foreground">
          What {project.name} needs from the client — files, copy, access,
          and decisions — and whether the team has reviewed what came
          back.
        </p>
      </div>

      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={project.id} />

      <Separator />

      <DeliverablesPanel
        projectId={project.id}
        initialDeliverables={deliverables}
        taskOptions={taskOptions}
        canManage={canManage}
      />
    </div>
  );
}
