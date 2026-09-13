"use server";

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionOutcome, type ActionResult, withAuthz, type ResolveWorkspaceResult } from "@/lib/actions/authz";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import {
  setProjectRoleSchema,
  removeProjectRoleSchema,
  type SetProjectRoleInput,
  type RemoveProjectRoleInput,
} from "@/lib/validation/project-roles";
import type { ProjectRoleValue } from "@/lib/queries/project-roles";

// F112 (missions/20260903-portal): the project-settings "Team" editor —
// assigns/removes a job title (`project_roles`) for a person already on
// the project. Gated the same way `setDecisionOwner`
// (lib/actions/approvals.ts) gates the sibling "Who approves what"
// editor it sits beside: `requireWrite: true` (any active workspace
// writer, not just a project lead/admin — same `canWrite` predicate
// `DecisionOwnersSection`'s `canManageDecisionOwners` prop already uses),
// `requireVisibility: true` so a private project a caller cannot see is
// treated as not-found, not a permission error.

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

type AdminClient = ReturnType<typeof createAdminClient>;

async function loadProjectExtra(
  admin: AdminClient,
  projectId: string,
): Promise<ResolveWorkspaceResult<{ projectId: string }>> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return { ok: false, error: "Project not found." };
  }

  return {
    ok: true,
    workspaceId: data.workspace_id,
    projectId: data.id,
    visibility: (data.visibility === "private" ? "private" : "workspace") as ProjectVisibility,
    extra: { projectId: data.id },
  };
}

async function revalidateProjectRoleSurfaces() {
  try {
    revalidatePath("/w", "layout");
    revalidatePath("/portal", "layout");
  } catch (revalidateError) {
    logger.error("project-roles: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

// ---------------------------------------------------------------------
// setProjectRole — add a role row, or update its note if the (project,
// user, role) triple already exists (`project_roles_project_user_role_
// unique`).
// ---------------------------------------------------------------------

export type SetProjectRoleResult = ActionResult<{ id: string; userId: string; role: ProjectRoleValue; note: string | null }>;

const setProjectRoleImpl = withAuthz(
  setProjectRoleSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's team.",
    writeError: "Viewers don't have permission to manage project roles.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's team.",
    resolveWorkspace: (input: SetProjectRoleInput, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<SetProjectRoleResult> => {
    // The chosen person must actually be an explicit project member —
    // mirrors setDecisionOwner's own "confirm the chosen user is
    // actually an active client member" cross-check
    // (lib/actions/approvals.ts), applied here to "is this person on the
    // project at all" instead.
    const { data: membership } = await ctx.admin
      .from("project_members")
      .select("user_id")
      .eq("project_id", ctx.projectId!)
      .eq("user_id", input.userId)
      .maybeSingle();

    if (!membership) {
      return { ok: false, error: "That person isn't a member of this project." };
    }

    const { data: upserted, error: upsertError } = await ctx.admin
      .from("project_roles")
      .upsert(
        {
          project_id: ctx.projectId!,
          user_id: input.userId,
          role: input.role,
          note: input.note,
          added_by: ctx.user.id,
        },
        { onConflict: "project_id,user_id,role" },
      )
      .select("id, user_id, role, note")
      .single();

    if (upsertError || !upserted) {
      logger.error("setProjectRole: upsert failed", { error: upsertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateProjectRoleSurfaces();

    return {
      ok: true,
      data: {
        id: upserted.id,
        userId: upserted.user_id,
        role: upserted.role as ProjectRoleValue,
        note: upserted.note,
      },
    };
  },
);

export async function setProjectRole(
  projectId: string,
  userId: string,
  role: ProjectRoleValue,
  note: string | null,
): Promise<SetProjectRoleResult> {
  return setProjectRoleImpl({ projectId, userId, role, note: note ?? undefined });
}

// ---------------------------------------------------------------------
// removeProjectRole
// ---------------------------------------------------------------------

export type RemoveProjectRoleResult = ActionOutcome;

const removeProjectRoleImpl = withAuthz(
  removeProjectRoleSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's team.",
    writeError: "Viewers don't have permission to manage project roles.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's team.",
    resolveWorkspace: (input: RemoveProjectRoleInput, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<RemoveProjectRoleResult> => {
    const { error: deleteError } = await ctx.admin
      .from("project_roles")
      .delete()
      .eq("id", input.roleId)
      .eq("project_id", ctx.projectId!);

    if (deleteError) {
      logger.error("removeProjectRole: delete failed", { error: deleteError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateProjectRoleSurfaces();
    return { ok: true };
  },
);

export async function removeProjectRole(
  projectId: string,
  roleId: string,
): Promise<RemoveProjectRoleResult> {
  return removeProjectRoleImpl({ projectId, roleId });
}
