import { redirect } from "next/navigation";
import Link from "next/link";

import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canManageProject} from "@/lib/auth/permissions";
import { getTaskTypes } from "@/lib/queries/task-types";
import { TaskTypeManager } from "@/components/workspace/task-type-manager";

// F434-F440: workspace settings "Task types" tab. Same access shape as
// the sibling status-templates settings page: a guest/client is denied
// outright, everyone else can view, only canManageProject (owner/admin)
// sees interactive controls — the real enforcement is every action in
// lib/actions/task-types.ts re-checking requireWorkspaceAdmin
// server-side.
export default async function TaskTypesSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

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

  const { workspace, role } = ctx;

  if (role === "guest" || role === "client") {
    redirect(`/w/${workspaceSlug}`);
  }

  const canManage = canManageProject({ role });
  const taskTypes = await getTaskTypes(workspace.id);

  return (
    <div className="flex flex-col gap-8 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Task types for {workspace.name}.
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
        <Link
          href={`/w/${workspaceSlug}/settings/status-templates`}
          className="px-1 pb-2 text-muted-foreground hover:text-foreground"
        >
          Status templates
        </Link>
        <span className="border-b-2 border-primary px-1 pb-2">
          Task types
        </span>
      </nav>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Task types</h2>
          <p className="text-sm text-muted-foreground">
            A tag you define once and apply to tasks — Setup, Design, Dev,
            SEO, QA, Add-on, or whatever fits how your team works. Filter
            and group by it on any project&apos;s List view.
          </p>
        </div>
        <TaskTypeManager
          workspaceId={workspace.id}
          initialTaskTypes={taskTypes}
          canManage={canManage}
        />
      </section>
    </div>
  );
}
