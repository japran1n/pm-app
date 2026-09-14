import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canWrite} from "@/lib/auth/permissions";
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
    .select("id, workspace_id, name, billing_model")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const budgetsResult = await getProjectBudgets(project.id);

  const canManage = canWrite({ role: workspaceRole });

  const budgets = budgetsResult.ok ? budgetsResult.data : [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Budget</h1>
        <p className="text-sm text-muted-foreground">
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
