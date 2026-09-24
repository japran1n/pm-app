import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canManagePortalSettings, canTeamWrite } from "@/lib/auth/permissions";
import { getPortalReadiness } from "@/lib/queries/portal-settings";
import { PortalSettingsPanel } from "@/components/project/portal-settings-panel";
import { ProjectSettingsNav } from "@/components/project/project-settings-nav";
import { Separator } from "@/components/ui/separator";

// F080 (missions/20260903-portal, hardening): project settings "Client
// portal" tab. Mirrors settings/measurement/page.tsx exactly in
// structure and chrome — a tab beside the other settings sub-nav
// entries, reached through the same ProjectSettingsNav. This is the tab
// added to close the audit's #1 finding: nothing anywhere in the app
// could write `projects.portal_enabled` before this feature.
//
// Server Component for data loading — the project's own portal/launch
// columns and the readiness checklist facts are server-fetched and
// passed down as typed props; the only Client Component is
// components/project/portal-settings-panel.tsx.
export default async function ProjectPortalSettingsPage({
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
    .select(
      "id, workspace_id, name, portal_enabled, target_launch_date, launch_confidence, launch_note, warranty_until, warranty_terms",
    )
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [readiness] = await Promise.all([
    getPortalReadiness(project.id),
  ]);

  const canManagePortal = canManagePortalSettings({ role: workspaceRole });
  const canEditLaunch = canTeamWrite({ role: workspaceRole });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Client portal</h1>
        <p className="text-sm text-muted-foreground">
          Turn the portal on for {project.name}, check whether it&rsquo;s ready, and set the
          launch date and warranty the client sees.
        </p>
      </div>

      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={project.id} />

      <Separator />

      <PortalSettingsPanel
        workspaceSlug={workspaceSlug}
        projectId={project.id}
        portalEnabled={project.portal_enabled}
        readiness={readiness}
        canManagePortal={canManagePortal}
        canEditLaunch={canEditLaunch}
        launch={{
          targetLaunchDate: project.target_launch_date,
          launchConfidence: project.launch_confidence as
            | "on_track"
            | "at_risk"
            | "slipped"
            | null,
          launchNote: project.launch_note,
          warrantyUntil: project.warranty_until,
          warrantyTerms: project.warranty_terms,
        }}
      />
    </div>
  );
}
