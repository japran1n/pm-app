import { logger } from "@/lib/observability/logger";

// Team member profile page (app/(workspace)/w/[workspaceSlug]/team/
// [userId]/page.tsx): "Projects" section — every project in this
// workspace the target person has an explicit `project_members` row on.
//
// Uses the normal RLS-respecting client — `project_members_select_active_
// members` (supabase/migrations/20260821140520_project_members.sql) scopes
// rows to any active workspace member of the project's own workspace,
// which is exactly the caller viewing this page. The `projects!inner(...)`
// embed additionally narrows to this ONE workspace and excludes archived/
// soft-deleted projects, same "projects!inner(...) + .eq(workspace_id) +
// .is(deleted_at, null)" pattern getMyTasks/getWorkspaceListTasks already
// use — this is a read of workspace-visible membership rows, not a
// resource that needs its own extra visibility check.
import { createClient } from "@/lib/supabase/server";

export type TeamMemberProjectRow = {
  projectId: string;
  projectKey: string | null;
  projectName: string;
  projectRole: "lead" | "member";
};

export async function getProjectsForMember(
  workspaceId: string,
  userId: string,
): Promise<TeamMemberProjectRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_members")
    .select(
      "project_role, projects!inner(id, key, name, workspace_id, deleted_at)",
    )
    .eq("user_id", userId)
    .eq("projects.workspace_id", workspaceId)
    .is("projects.deleted_at", null);

  if (error) {
    logger.error("getProjectsForMember: fetch failed", { error: error });
    throw error;
  }

  return (data ?? [])
    .map((row) => {
      const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
      if (!project) return null;
      return {
        projectId: project.id as string,
        projectKey: (project.key ?? null) as string | null,
        projectName: project.name as string,
        projectRole: row.project_role as "lead" | "member",
      };
    })
    .filter((row): row is TeamMemberProjectRow => row !== null);
}
