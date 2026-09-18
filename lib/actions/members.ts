"use server";

// P2-25: lightweight helpers for the remove-member dialog.

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireWorkspaceAdmin } from "@/lib/auth/require-membership";
import { logger } from "@/lib/observability/logger";

// Returns the number of tasks currently assigned to `userId` across ALL
// tasks visible to the workspace (not filtered to projects — the count
// is a pre-removal preview, not an access-scoped query).
//
// Authorization: caller must be an active owner or admin of the workspace.
// A failure returns count=0 rather than propagating to the dialog.
export async function getAssignedTaskCount(
  workspaceId: string,
  userId: string,
): Promise<{ count: number }> {
  try {
    const { user } = await getCurrentUser();
    if (!user) return { count: 0 };

    // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireWorkspaceAdmin(); caller identity already verified via getCurrentUser()/!user check immediately above
    const admin = createAdminClient();

    const membership = await requireWorkspaceAdmin(admin, workspaceId, user.id);
    if (!membership.ok) return { count: 0 };

    // Count via task_assignees → tasks → projects → workspace_id so we
    // only count tasks that actually belong to this workspace.
    const { count, error } = await admin
      .from("task_assignees")
      .select(
        "task_id, tasks!inner(project_id, projects!inner(workspace_id))",
        { count: "exact", head: true },
      )
      .eq("user_id", userId)
      .eq("tasks.projects.workspace_id", workspaceId);

    if (error) {
      logger.error("getAssignedTaskCount: query failed", { error });
      return { count: 0 };
    }

    return { count: count ?? 0 };
  } catch (err) {
    logger.error("getAssignedTaskCount: unexpected error", { error: err });
    return { count: 0 };
  }
}
