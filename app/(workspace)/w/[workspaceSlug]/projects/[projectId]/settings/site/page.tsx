import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
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

  const [{ data: ownWorkspaceMembership }, linksResult, accountsResult] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    getProjectLinks(project.id),
    getProjectAccounts(project.id),
  ]);

  const workspaceRole = (ownWorkspaceMembership?.role ?? "guest") as WorkspaceRole;
  const canManage = canWrite({ role: workspaceRole });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Site</h1>
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
