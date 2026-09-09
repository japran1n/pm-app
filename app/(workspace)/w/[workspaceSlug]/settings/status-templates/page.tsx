import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { canManageProject, type WorkspaceRole } from "@/lib/auth/permissions";
import { getStatusTemplates } from "@/lib/queries/status-templates";
import { StatusTemplateManager } from "@/components/workspace/status-template-manager";

// F428-F430: workspace settings "Status templates" tab. Same access shape
// as the sibling settings page (app/(workspace)/w/[workspaceSlug]/settings/
// page.tsx): a guest is denied outright, everyone else can view, and only
// canManageProject (owner/admin) sees interactive controls — the real
// enforcement is every action in lib/actions/status-templates.ts
// re-checking requireWorkspaceAdmin server-side.
export default async function StatusTemplatesSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    redirect("/onboarding");
  }

  const { data: ownMembership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const role = (ownMembership?.role ?? "guest") as WorkspaceRole;

  if (role === "guest" || role === "client") {
    redirect(`/w/${workspaceSlug}`);
  }

  const canManage = canManageProject({ role });
  const templates = await getStatusTemplates(workspace.id);

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Status templates for {workspace.name}.
        </p>
      </div>

      <nav className="flex gap-4 border-b text-sm font-medium">
        <Link
          href={`/w/${workspaceSlug}/settings`}
          className="px-1 pb-2 text-muted-foreground hover:text-foreground"
        >
          General
        </Link>
        <Link
          href={`/w/${workspaceSlug}/settings/members`}
          className="px-1 pb-2 text-muted-foreground hover:text-foreground"
        >
          Members
        </Link>
        <span className="border-b-2 border-primary px-1 pb-2">
          Status templates
        </span>
        <Link
          href={`/w/${workspaceSlug}/settings/task-types`}
          className="px-1 pb-2 text-muted-foreground hover:text-foreground"
        >
          Task types
        </Link>
      </nav>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Status templates</h2>
          <p className="text-sm text-muted-foreground">
            Reusable sets of board columns. Apply one from a project&apos;s
            Settings → Columns page instead of rebuilding columns by hand
            on every new project.
          </p>
        </div>
        <StatusTemplateManager
          workspaceId={workspace.id}
          initialTemplates={templates}
          canManage={canManage}
        />
      </section>
    </div>
  );
}
