import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canWrite} from "@/lib/auth/permissions";
import { getProjectAccounts, getProjectLinks } from "@/lib/queries/project-site";
import { SitePanel } from "@/components/project/site-panel";
import { ProjectSettingsNav } from "@/components/project/project-settings-nav";
import { Separator } from "@/components/ui/separator";

// F022 (missions/20260903-portal, AS-049, AS-050): project settings
// "Site" panel — links and accounts. Mirrors settings/record/page.tsx
// exactly in structure: Server Component for data loading (both lists
// fetched in parallel and passed down as typed props), the only Client
// Component is components/project/site-panel.tsx.
export default async function ProjectSiteSettingsPage({
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

  const [linksResult, accountsResult] = await Promise.all([
    getProjectLinks(project.id),
    getProjectAccounts(project.id),
  ]);

  const canManage = canWrite({ role: workspaceRole });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Site</h1>
        <p className="text-sm text-muted-foreground">
          {project.name}&rsquo;s environments, tools, and the accounts the client will own at
          handover.
        </p>
      </div>

      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={project.id} />

      <Separator />

      <SitePanel
        projectId={project.id}
        initialLinks={linksResult.ok ? linksResult.data : []}
        initialAccounts={accountsResult.ok ? accountsResult.data : []}
        canManage={canManage}
      />
    </div>
  );
}
