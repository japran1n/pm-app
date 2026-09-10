"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { setTaskBlockedReasonSchema } from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import { withAuthz } from "@/lib/actions/authz";
import { canEditTask } from "@/lib/auth/permissions";
import { type ProjectVisibility } from "@/lib/actions/project-visibility";

export type SetTaskBlockedReasonResult =
  | { ok: true; data: { id: string; blockedReason: string | null } }
  | { ok: false; error: string };

async function loadTaskForBlockedReason(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
) {
  const { data, error } = await admin
    .from("tasks")
    .select(
      "id, deleted_at, projects!inner(id, workspace_id, visibility, deleted_at)",
    )
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) {
    return { ok: false as const, error: "Task not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false as const, error: "Task not found." };
  }

  return {
    ok: true as const,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: (project.visibility === "private" ? "private" : "workspace") as ProjectVisibility,
    extra: { taskId: data.id },
  };
}

const setTaskBlockedReasonImpl = withAuthz(
  setTaskBlockedReasonSchema,
  {
    requireWrite: true,
    writeCheck: canEditTask,
    requireVisibility: true,
    membershipError: "You don't have permission to edit this task.",
    writeError: "You don't have permission to edit this task.",
    visibilityError: "You don't have permission to edit this task.",
    resolveWorkspace: (input, admin) => loadTaskForBlockedReason(admin, input.taskId),
  },
  async (input, ctx): Promise<SetTaskBlockedReasonResult> => {
    const { data: updated, error } = await ctx.admin
      .from("tasks")
      .update({ blocked_reason: input.blockedReason })
      .eq("id", input.taskId)
      .select("id, blocked_reason")
      .single();

    if (error || !updated) {
      logger.error("setTaskBlockedReason: update failed", { error });
      return { ok: false, error: "Something went wrong. Please try again in a moment." };
    }

    return { ok: true, data: { id: updated.id, blockedReason: updated.blocked_reason } };
  },
);

export async function setTaskBlockedReason(
  taskId: string,
  blockedReason: string | null,
): Promise<SetTaskBlockedReasonResult> {
  return setTaskBlockedReasonImpl({ taskId, blockedReason });
}

