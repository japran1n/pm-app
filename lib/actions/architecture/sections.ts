"use server";

// Section actions for the Architecture board, split out of the original
// single-file lib/actions/architecture.ts as a PURE MOVE -- no behaviour,
// comment, or call site changed. See lib/actions/architecture.ts (now a
// re-export barrel) for the split rationale.
import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite } from "@/lib/auth/permissions";
import { createSectionSchema } from "@/lib/validation/architecture";
import { z } from "zod";

import type { MutationResult, MutationWithIdResult } from "./shared";

// Mission 20260910-182104, F013 (AS-003, AS-029, AS-038): creates a section
// under a page. Standing decision 1: a section IS a subtask of the page
// task (`parent_task_id = pageTaskId`, no `page_slug`) -- so this is a
// targeted, page-scoped subtask insert, same membership/permission
// re-check convention as createPage/changePageKind above, not a second
// creation path parallel to createTaskForUser (lib/tasks/create.ts).
export async function createSection(
  pageTaskId: string,
  projectId: string,
  title: string,
): Promise<MutationWithIdResult> {
  const parsed = createSectionSchema.safeParse({
    title,
    page_id: pageTaskId,
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid section name.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to create a section." };
  }

  const admin = createAdminClient();

  // Look up the project's owning workspace server-side -- never trust a
  // workspace id supplied by the client -- same convention createPage
  // uses.
  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id, deleted_at")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (projectError || !projectRow) {
    return { success: false, error: "Project not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    projectRow.workspace_id,
    user.id,
  );

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to create a section in this project.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to create sections.",
    };
  }

  // Confirm the parent is actually a page (page_slug set, no
  // parent_task_id of its own) belonging to this project before attaching
  // a section to it.
  const { data: pageRow, error: pageError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, parent_task_id")
    .eq("id", pageTaskId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    pageError ||
    !pageRow ||
    !pageRow.page_slug ||
    pageRow.parent_task_id !== null
  ) {
    return { success: false, error: "Page not found." };
  }

  // AS-002: sections use the same `page` task type as the page they
  // belong to -- resolved via the same `ensure_task_type` helper as
  // createPage.
  const { data: pageTaskTypeId, error: ensureError } = await admin.rpc(
    "ensure_task_type",
    {
      p_workspace_id: projectRow.workspace_id,
      p_system_key: "page",
      p_name: "Page",
      p_color: "#3670e1",
      p_is_billable: false,
      p_default_client_visible: false,
    },
  );

  if (ensureError || !pageTaskTypeId) {
    logger.error("createSection: failed to resolve 'page' task type", {
      error: ensureError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // AS-038: append to the end of this page's existing section list --
  // count existing subtasks of this page task, using the exact
  // "parent_task_id = page id" shape lib/queries/architecture.ts's
  // buildBoardFromRows groups sections by, so the new section always
  // sorts after every existing one on this page.
  const { count: existingSectionCount, error: countError } = await admin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("parent_task_id", pageTaskId)
    .is("deleted_at", null);

  if (countError) {
    logger.error("createSection: failed to count existing sections", {
      error: countError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const newPosition = (existingSectionCount ?? 0) + 1;

  const { data: inserted, error: insertError } = await admin
    .from("tasks")
    .insert({
      project_id: projectId,
      title: parsed.data.title,
      parent_task_id: pageTaskId,
      task_type_id: pageTaskTypeId,
      author_id: user.id,
      position: newPosition,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    logger.error("createSection: insert failed", { error: insertError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("createSection: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true, id: inserted.id };
}

// Mission 20260910-182104, F017 (AS-035): deletes a section from the
// board. Standing decision 1: a section IS a subtask of its page
// (`parent_task_id` set, no `page_slug` of its own) -- discovery
// established the board is flat (sections have no sub-sections of their
// own), so unlike deletePage this needs no cascade: a plain soft-delete
// of this one task row is enough. Still reuses `cascade_delete_task`
// (same RPC deletePage calls) rather than a bespoke `.update()` here --
// it degrades to a single-row soft-delete when the target has no live
// children, and keeps every delete on the board going through one
// audited path (stamping `deleted_via_task_id` consistently) instead of
// two.
export async function deleteSection(
  taskId: string,
): Promise<MutationResult> {
  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to delete a section." };
  }

  const admin = createAdminClient();

  // Look up the task's owning project/workspace server-side, and confirm
  // it is actually a section (has a parent page, no page_slug of its
  // own) before touching it -- same convention as deletePage above.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, parent_task_id, projects(workspace_id)")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    taskError ||
    !taskRow ||
    taskRow.page_slug ||
    !taskRow.parent_task_id ||
    !(taskRow as { projects?: { workspace_id?: string } }).projects?.workspace_id
  ) {
    return { success: false, error: "Section not found." };
  }

  const workspaceId = (taskRow as { projects: { workspace_id: string } }).projects
    .workspace_id;

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to delete this section.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to delete a section.",
    };
  }

  const { data: cascadeResult, error: cascadeError } = await admin.rpc(
    "cascade_delete_task",
    { p_task_id: taskId },
  );

  if (cascadeError || !cascadeResult) {
    logger.error("deleteSection: cascade_delete_task failed", {
      error: cascadeError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("deleteSection: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

// Mission 20260910-182104, F015 (AS-007, AS-034, AS-040): renames a
// section inline on the board. Standing decision 1: a section IS a
// subtask of its page task (`parent_task_id` set, no `page_slug`), so
// renaming a section is exactly the same targeted `title` update
// renamePage performs on a page task above -- the section list already
// reads that same `title` column, so AS-007 ("renaming a section outside
// the board changes the name shown on the board") falls out for free
// from sharing that one column, with no separate display name to keep in
// sync. Ownership check confirms the target task is actually a section
// (has a non-null `parent_task_id`, i.e. it is NOT a page) before
// touching it, mirroring renamePage's "confirm it's actually a page"
// guard in the opposite direction.
export async function renameSection(
  taskId: string,
  title: string,
): Promise<MutationResult> {
  // AS-040: a section cannot be saved with an empty name.
  const parsed = z
    .string()
    .trim()
    .min(1, "Section name is required.")
    .max(200, "Section name must be 200 characters or fewer.")
    .safeParse(title);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Section name is required.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to rename a section.",
    };
  }

  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, parent_task_id, projects(workspace_id)")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    taskError ||
    !taskRow ||
    !taskRow.parent_task_id ||
    !(taskRow as { projects?: { workspace_id?: string } }).projects
      ?.workspace_id
  ) {
    return { success: false, error: "Section not found." };
  }

  const workspaceId = (taskRow as { projects: { workspace_id: string } })
    .projects.workspace_id;

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to rename this section.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to rename a section.",
    };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ title: parsed.data })
    .eq("id", taskId);

  if (updateError) {
    logger.error("renameSection: update failed", { error: updateError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("renameSection: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

// Mission 20260910-182104, F020 (AS-041, AS-042): reorders sections
// within a single page column via drag-and-drop. A section IS a subtask
// of its page task (standing decision 1), so reordering is a batched
// `position` update across the dragged section's siblings, mirroring the
// "append at count+1" position convention createSection already uses for
// the initial order. Membership/permission is re-checked per-task
// server-side (defense in depth) rather than trusting the client's drag
// result wholesale -- every id in `updates` must resolve to a live
// section (parent_task_id set) whose owning workspace the caller is an
// active, write-capable member of; if any single id fails that check the
// whole batch is rejected rather than partially applied.
export async function reorderSections(
  updates: { id: string; position: number }[],
): Promise<MutationResult> {
  if (!Array.isArray(updates) || updates.length === 0) {
    return { success: false, error: "No sections to reorder." };
  }

  for (const update of updates) {
    if (
      typeof update.id !== "string" ||
      !update.id ||
      typeof update.position !== "number" ||
      !Number.isFinite(update.position)
    ) {
      return { success: false, error: "Invalid reorder payload." };
    }
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to reorder sections." };
  }

  const admin = createAdminClient();

  const ids = updates.map((update) => update.id);

  const { data: taskRows, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, parent_task_id, projects(workspace_id)")
    .in("id", ids)
    .is("deleted_at", null);

  if (taskError || !taskRows || taskRows.length !== ids.length) {
    return { success: false, error: "Section not found." };
  }

  const membershipCache = new Map<string, boolean>();

  for (const taskRow of taskRows) {
    if (taskRow.page_slug || !taskRow.parent_task_id) {
      return { success: false, error: "Section not found." };
    }

    const workspaceId = (taskRow as { projects?: { workspace_id?: string } })
      .projects?.workspace_id;

    if (!workspaceId) {
      return { success: false, error: "Section not found." };
    }

    if (!membershipCache.has(workspaceId)) {
      const membership = await requireActiveMembership(admin, workspaceId, user.id);
      const allowed = membership.ok && canWrite({ role: membership.role });
      membershipCache.set(workspaceId, allowed);
    }

    if (!membershipCache.get(workspaceId)) {
      return {
        success: false,
        error: "You don't have permission to reorder these sections.",
      };
    }
  }

  const results = await Promise.all(
    updates.map((update) =>
      admin.from("tasks").update({ position: update.position }).eq("id", update.id),
    ),
  );

  const failed = results.find((result) => result.error);
  if (failed) {
    logger.error("reorderSections: update failed", { error: failed.error });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("reorderSections: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

// Mission 20260910-182104, F021 (AS-043, AS-044, AS-045): a section can be
// dragged from one page's column to another. A section IS a subtask of its
// page task (standing decision 1), so "move to another page" is nothing
// more than repointing `parent_task_id` at the destination page's task id
// plus setting a `position` among the destination's existing sections --
// the exact same `tasks` row, same id, same `component_id` the whole way
// through (AS-045: the component link is never read or written here, so
// it can't be cleared by a move). AS-044 falls out of the same
// `parent_task_id` write reorderSections already relies on elsewhere: the
// architecture board (and the task list's subtask view) both derive "is
// this a subtask of that page" purely from `parent_task_id`.
//
// Membership/permission is re-checked server-side against BOTH the
// section's current workspace and the destination page's workspace
// (defense in depth, same convention as reorderSections) -- a page task
// id supplied by the client is never trusted without an independent
// lookup.
export async function moveSectionToPage(
  sectionTaskId: string,
  newPageTaskId: string,
  position: number,
): Promise<MutationResult> {
  if (typeof sectionTaskId !== "string" || !sectionTaskId) {
    return { success: false, error: "Invalid section." };
  }

  if (typeof newPageTaskId !== "string" || !newPageTaskId) {
    return { success: false, error: "Invalid destination page." };
  }

  if (typeof position !== "number" || !Number.isFinite(position)) {
    return { success: false, error: "Invalid position." };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to move sections." };
  }

  const admin = createAdminClient();

  const { data: sectionRow, error: sectionError } = await admin
    .from("tasks")
    .select("id, page_slug, parent_task_id, projects(workspace_id)")
    .eq("id", sectionTaskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (sectionError || !sectionRow || sectionRow.page_slug || !sectionRow.parent_task_id) {
    return { success: false, error: "Section not found." };
  }

  const { data: pageRow, error: pageError } = await admin
    .from("tasks")
    .select("id, page_slug, projects(workspace_id)")
    .eq("id", newPageTaskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (pageError || !pageRow || !pageRow.page_slug) {
    return { success: false, error: "Destination page not found." };
  }

  const sectionWorkspaceId = (sectionRow as { projects?: { workspace_id?: string } })
    .projects?.workspace_id;
  const pageWorkspaceId = (pageRow as { projects?: { workspace_id?: string } })
    .projects?.workspace_id;

  if (!sectionWorkspaceId || !pageWorkspaceId || sectionWorkspaceId !== pageWorkspaceId) {
    return { success: false, error: "Destination page not found." };
  }

  const membership = await requireActiveMembership(admin, sectionWorkspaceId, user.id);
  if (!membership.ok || !canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "You don't have permission to move this section.",
    };
  }

  // AS-045: `component_id` is deliberately absent from this update -- the
  // section keeps whatever component link it already had, on the same
  // row, untouched.
  const { error: updateError } = await admin
    .from("tasks")
    .update({ parent_task_id: newPageTaskId, position })
    .eq("id", sectionTaskId);

  if (updateError) {
    logger.error("moveSectionToPage: update failed", { error: updateError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("moveSectionToPage: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}
