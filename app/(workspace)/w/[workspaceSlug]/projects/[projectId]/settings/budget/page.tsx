import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import { getProjectBudgets } from "@/lib/queries/project-budgets";
import { BudgetPanel } from "@/components/project/budget-panel";
import { ProjectSettingsNav } from "@/components/project/project-settings-nav";
import { Separator } from "@/components/ui/separator";

// F018 (missions/20260903-portal): project settings "Budget" panel
// (AS-033). Mirrors settings/deliverables/page.tsx exactly in structure
// and chrome — see that file's own doc comment for why. Server Component
// for data loading; the only Client Component is
// components/project/budget-panel.tsx.
export default async function ProjectBudgetSettingsPage({
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
    .select("id, workspace_id, name, billing_model")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [{ data: ownWorkspaceMembership }, budgetsResult] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    getProjectBudgets(project.id),
  ]);

  const workspaceRole = (ownWorkspaceMembership?.role ?? "guest") as WorkspaceRole;
  const canManage = canWrite({ role: workspaceRole });

  const budgets = budgetsResult.ok ? budgetsResult.data : [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="title-1 font-semibold">Budget</h1>
        <p className="text-mini text-muted-foreground">
          Sold hours for {project.name}, by period — spend against each
          period is shown beside the field as it&apos;s entered, and a
          daily sweep notifies the project&apos;s lead at 80% and 100%.
        </p>
      </div>

      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={project.id} />

      <Separator />

      <BudgetPanel
        projectId={project.id}
        initialBudgets={budgets}
        billingModel={(project.billing_model as "hourly" | "fixed_price" | null) ?? "fixed_price"}
        canManage={canManage}
      />
    </div>
  );
}
