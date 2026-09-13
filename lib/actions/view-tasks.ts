"use server";

// Follow-up to F227/F228/F229: manual (filter-independent) task membership
// in a saved view, backed by `public.view_tasks`
// (supabase/migrations/20260907010000_create_view_tasks.sql). Mirrors
// lib/actions/views.ts's own authorization shape almost exactly:
// - RLS is the "owner only" floor for writes (view_tasks_insert_owner /
//   _update_owner / _delete_owner).
// - The "creator OR admin-of-a-shared-view" exception the same repo
//   convention grants elsewhere (AS-430 for saved_views itself) is
//   re-checked here via `canManageSavedView` and executed through the
//   admin client, exactly like updateSavedView/deleteSavedView.
// - Read (`listViewTaskIds`) goes through the session-scoped client so
//   `view_tasks_select_visible`'s correlated-subquery-on-saved_views
//   policy is the real, exercised visibility boundary -- no admin client
//   needed for a read.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageSavedView } from "@/lib/auth/permissions";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import type { SavedViewScope } from "@/lib/validation/views";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const NOT_FOUND_ERROR = "View not found.";
const PERMISSION_DENIED_ERROR = "You don't have permission to manage this view.";

const addTaskToViewSchema = z.object({
  viewId: z.string().uuid("Invalid view."),
  taskId: z.string().uuid("Invalid task."),
  position: z.number().finite().optional(),
});

const removeTaskFromViewSchema = z.object({
  viewId: z.string().uuid("Invalid view."),
  taskId: z.string().uuid("Invalid task."),
});

const reorderTaskInViewSchema = z.object({
  viewId: z.string().uuid("Invalid view."),
  taskId: z.string().uuid("Invalid task."),
  position: z.number().finite(),
});

type LoadedView = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  ownerId: string;
  scope: SavedViewScope;
};

async function loadViewForAuthz(
  admin: ReturnType<typeof createAdminClient>,
  viewId: string,
): Promise<LoadedView | null> {
  const { data, error } = await admin
    .from("saved_views")
    .select("id, workspace_id, project_id, owner_id, scope")
    .eq("id", viewId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    projectId: data.project_id,
    ownerId: data.owner_id,
    scope: data.scope as SavedViewScope,
  };
}

// Same shape as lib/actions/views.ts's authorizeViewMutation: re-verifies
// membership/visibility, then either "caller is the owner" or (for a
// shared view only) "caller is an admin allowed to manage it."
async function authorizeViewMembershipMutation(
  admin: ReturnType<typeof createAdminClient>,
  view: LoadedView,
  userId: string,
): Promise<{ isOwner: boolean } | null> {
  const membership = await requireActiveMembership(admin, view.workspaceId, userId);
  if (!membership.ok) {
    return null;
  }

  if (view.projectId) {
    const { data: project } = await admin
      .from("projects")
      .select("id, workspace_id, visibility, deleted_at")
      .eq("id", view.projectId)
      .maybeSingle();
    if (!project || project.deleted_at) {
      return null;
    }
    const visible = await isProjectVisibleToCaller(
      admin,
      {
        projectId: project.id,
        visibility: project.visibility === "private" ? "private" : "workspace",
      },
      userId,
      membership.role,
    );
    if (!visible) {
      return null;
    }
  }

  if (view.ownerId === userId) {
    return { isOwner: true };
  }

  if (view.scope !== "shared") {
    return null;
  }

  const allowed = canManageSavedView({
    role: membership.role,
    resourceOwnerId: view.ownerId,
    callerId: userId,
  });
  if (!allowed) {
    return null;
  }

  return { isOwner: false };
}

async function revalidateViewRoutes(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
) {
  try {
    const { data: workspaceRow } = await admin
      .from("workspaces")
      .select("slug")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspaceRow?.slug) {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    }
  } catch (revalidateError) {
    logger.error("view-tasks: revalidatePath failed (non-fatal)", { error: revalidateError });
  }
}

export type ViewTaskActionResult =
  | { ok: true; data: { viewId: string; taskId: string } }
  | { ok: false; error: string };

// Manually pins `taskId` into `viewId`, independent of the view's own
// filter config. Idempotent by design (unique (view_id, task_id)): adding
// a task that's already pinned is a no-op success, not an error -- the
// same "intentional no-op" convention lib/actions/views.ts's updateSavedView
// already follows for a no-op patch.
export async function addTaskToView(input: {
  viewId: string;
  taskId: string;
  position?: number;
}): Promise<ViewTaskActionResult> {
  const parsed = addTaskToViewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage views." };
  }

  const admin = createAdminClient();
  const view = await loadViewForAuthz(admin, parsed.data.viewId);
  if (!view) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const authz = await authorizeViewMembershipMutation(admin, view, user.id);
  if (!authz) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  // The task must actually be visible/reachable by the caller -- re-uses
  // the task's own project visibility rather than trusting the client.
  const { data: task } = await admin
    .from("tasks")
    .select("id, project_id, deleted_at")
    .eq("id", parsed.data.taskId)
    .maybeSingle();
  if (!task || task.deleted_at) {
    return { ok: false, error: "Task not found." };
  }

  const client = authz.isOwner ? supabase : admin;
  const { error: upsertError } = await client
    .from("view_tasks")
    .upsert(
      {
        view_id: view.id,
        task_id: parsed.data.taskId,
        added_by: user.id,
        ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
      },
      { onConflict: "view_id,task_id", ignoreDuplicates: false },
    );

  if (upsertError) {
    logger.error("addTaskToView: upsert failed", { error: upsertError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateViewRoutes(admin, view.workspaceId);

  return { ok: true, data: { viewId: view.id, taskId: parsed.data.taskId } };
}

// Removes a manual membership row. Removing a task that was never
// manually added is a no-op success (nothing to delete) -- it does NOT
// remove a task that still matches the view's own filter; that union is
// computed at read time by lib/views/apply-view.ts's mergeManualTaskIds.
export async function removeTaskFromView(input: {
  viewId: string;
  taskId: string;
}): Promise<ViewTaskActionResult> {
  const parsed = removeTaskFromViewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage views." };
  }

  const admin = createAdminClient();
  const view = await loadViewForAuthz(admin, parsed.data.viewId);
  if (!view) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const authz = await authorizeViewMembershipMutation(admin, view, user.id);
  if (!authz) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  const client = authz.isOwner ? supabase : admin;
  const { error: deleteError } = await client
    .from("view_tasks")
    .delete()
    .eq("view_id", view.id)
    .eq("task_id", parsed.data.taskId);

  if (deleteError) {
    logger.error("removeTaskFromView: delete failed", { error: deleteError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateViewRoutes(admin, view.workspaceId);

  return { ok: true, data: { viewId: view.id, taskId: parsed.data.taskId } };
}

// Updates a pinned task's position (fractional-index convention, same as
// lib/board/position.ts's calculatePosition -- callers compute the new
// position client-side the same way board drag-reorder already does).
export async function reorderTaskInView(input: {
  viewId: string;
  taskId: string;
  position: number;
}): Promise<ViewTaskActionResult> {
  const parsed = reorderTaskInViewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage views." };
  }

  const admin = createAdminClient();
  const view = await loadViewForAuthz(admin, parsed.data.viewId);
  if (!view) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const authz = await authorizeViewMembershipMutation(admin, view, user.id);
  if (!authz) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  const client = authz.isOwner ? supabase : admin;
  const { error: updateError } = await client
    .from("view_tasks")
    .update({ position: parsed.data.position })
    .eq("view_id", view.id)
    .eq("task_id", parsed.data.taskId);

  if (updateError) {
    logger.error("reorderTaskInView: update failed", { error: updateError });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, data: { viewId: view.id, taskId: parsed.data.taskId } };
}

export type ListViewTaskIdsResult =
  | { ok: true; data: string[] }
  | { ok: false; error: string };

// Reads the manually pinned task ids for a view, in position order.
// Session-scoped client -- `view_tasks_select_visible`'s RLS policy
// (which itself defers to saved_views' own visibility rule) is the real
// enforcement boundary, no admin client involved, matching
// lib/actions/views.ts's own getSavedView.
export async function listViewTaskIds(viewId: string): Promise<ListViewTaskIdsResult> {
  if (typeof viewId !== "string" || viewId.length === 0) {
    return { ok: false, error: "Invalid view." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to view this." };
  }

  const { data, error } = await supabase
    .from("view_tasks")
    .select("task_id, position")
    .eq("view_id", viewId)
    .order("position", { ascending: true });

  if (error) {
    logger.error("listViewTaskIds: select failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, data: (data ?? []).map((row) => row.task_id) };
}
