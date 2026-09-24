"use server";

// Section actions for the Architecture board, split out of the original
// single-file lib/actions/architecture.ts as a PURE MOVE -- no behaviour,
// comment, or call site changed. See lib/actions/architecture.ts (now a
// re-export barrel) for the split rationale.
import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { revalidatePortalProject } from "@/lib/actions/portal-revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSectionSchema, changeSectionKindSchema } from "@/lib/validation/architecture";
import { z } from "zod";
import { writeAudit } from "@/lib/activity/audit";

import type { MutationResult, MutationWithIdResult } from "./shared";
import type { ActionResult } from "@/lib/actions/authz";
import {
  authorizeArchitectureProject,
  authorizeArchitectureProjects,
  areArchitectureSections,
  loadArchitecturePages,
} from "./authorize";

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

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Confirm the parent is actually a page (page_slug set, no
  // parent_task_id of its own) belonging to this project before attaching
  // a section to it. The project is authorized from the page row.
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

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    pageRow.project_id,
  );

  if (!authz.ok) {
    return authz.reason === "not_found"
      ? { success: false, error: "Project not found." }
      : {
          success: false,
          error: "You don't have permission to create a section in this project.",
        };
  }

  const createSectionWorkspaceSlug = authz.access.workspaceSlug;

  // AS-002: sections use the same `page` task type as the page they
  // belong to -- resolved via the same `ensure_task_type` helper as
  // createPage.
  const { data: pageTaskTypeId, error: ensureError } = await admin.rpc(
    "ensure_task_type",
    {
      p_workspace_id: authz.access.workspaceId,
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

  if (createSectionWorkspaceSlug) {
    revalidatePortalProject(createSectionWorkspaceSlug, projectId);
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

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Look up the task's owning project/workspace server-side, and confirm
  // it is actually a section (has a parent page, no page_slug of its
  // own) before touching it -- same convention as deletePage above.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, project_id, page_slug, parent_task_id, projects(workspace_id, workspaces(slug))",
    )
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

  if (!(await areArchitectureSections(admin, [taskRow]))) {
    return { success: false, error: "Section not found." };
  }

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to delete this section.",
    };
  }

  const deleteSectionWorkspaceSlug = authz.access.workspaceSlug;

  const { data: cascadeResult, error: cascadeError } = await admin.rpc(
    "cascade_delete_task",
    { p_task_id: taskId, p_deleted_by: user.id },
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

  if (deleteSectionWorkspaceSlug) {
    revalidatePortalProject(deleteSectionWorkspaceSlug, taskRow.project_id);
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

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, parent_task_id, projects(workspace_id, workspaces(slug))")
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

  if (!(await areArchitectureSections(admin, [taskRow]))) {
    return { success: false, error: "Section not found." };
  }

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to rename this section.",
    };
  }

  const renameSectionWorkspaceSlug = authz.access.workspaceSlug;

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

  if (renameSectionWorkspaceSlug) {
    revalidatePortalProject(renameSectionWorkspaceSlug, taskRow.project_id);
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

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const ids = updates.map((update) => update.id);

  if (new Set(ids).size !== ids.length) {
    return { success: false, error: "Invalid reorder payload." };
  }

  const { data: taskRows, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, parent_task_id")
    .in("id", ids)
    .is("deleted_at", null);

  if (taskError || !taskRows || taskRows.length !== ids.length) {
    return { success: false, error: "Section not found." };
  }

  if (!(await areArchitectureSections(admin, taskRows))) {
    return { success: false, error: "Section not found." };
  }

  // Every project the batch touches is authorized, resolved from the rows
  // themselves; one failure rejects the whole batch.
  const authz = await authorizeArchitectureProjects(
    admin,
    user.id,
    taskRows.map((row) => row.project_id),
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to reorder these sections.",
    };
  }

  // F004c (AS-006): keyed by projectId, NOT slug — two different projects
  // in the SAME workspace share the same workspace slug.
  const reorderSectionsPortalTargets = new Map<string, string>();
  for (const [projectIdForSlug, access] of authz.accessByProject) {
    if (access.workspaceSlug) {
      reorderSectionsPortalTargets.set(projectIdForSlug, access.workspaceSlug);
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

  for (const [projectIdForSlug, slug] of reorderSectionsPortalTargets) {
    revalidatePortalProject(slug, projectIdForSlug);
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

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: sectionRow, error: sectionError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, parent_task_id")
    .eq("id", sectionTaskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    sectionError ||
    !sectionRow ||
    !(await areArchitectureSections(admin, [sectionRow]))
  ) {
    return { success: false, error: "Section not found." };
  }

  // The destination must be a live top-level page in the section's own
  // project; a section never moves across projects.
  const destinationPages = await loadArchitecturePages(admin, [newPageTaskId]);

  if (destinationPages?.get(newPageTaskId) !== sectionRow.project_id) {
    return { success: false, error: "Destination page not found." };
  }

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    sectionRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to move this section.",
    };
  }

  const moveSectionWorkspaceSlug = authz.access.workspaceSlug;

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

  if (moveSectionWorkspaceSlug) {
    revalidatePortalProject(moveSectionWorkspaceSlug, sectionRow.project_id);
  }

  return { success: true };
}

// F003 (AS-004, AS-005): same share/unshare toggle as
// setPageClientVisibility above, for a single section. A section IS a
// subtask of its page (standing decision 1), so this targets exactly one
// row (`WHERE id = sectionTaskId`) -- other sections and the parent page
// are never touched.
export type SetSectionClientVisibilityResult = ActionResult<{
  taskId: string;
  clientVisible: boolean;
  // AS-004/AS-005 UI hint (scrutiny remediation, item 10): true when
  // this section was just shared but its parent page is still hidden
  // from the client, so the UI can prompt "share the page too" -- a
  // section the client can't reach because its page is hidden is
  // otherwise a silent no-op from the client's view.
  pageHidden: boolean;
}>;

export async function setSectionClientVisibility(
  taskId: string,
  visible: boolean,
): Promise<SetSectionClientVisibilityResult> {
  const parsed = z
    .object({ taskId: z.string().uuid("Invalid section."), visible: z.boolean() })
    .safeParse({ taskId, visible });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid section.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, project_id, page_slug, parent_task_id",
    )
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  // Only a real architecture section (a non-page child of a top-level page
  // in the same project) can be shared from here; any other subtask goes
  // through setTaskClientVisibility.
  if (
    taskError ||
    !taskRow ||
    !taskRow.parent_task_id ||
    !(await areArchitectureSections(admin, [taskRow]))
  ) {
    return { ok: false, error: "Section not found." };
  }

  // Same gate as setTaskClientVisibility (lib/actions/client-visibility.ts):
  // `canEditTask`, plus project visibility since the write below bypasses
  // RLS.
  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
    { writeGate: "task" },
  );

  if (!authz.ok) {
    return authz.reason === "not_found"
      ? { ok: false, error: "Section not found." }
      : {
          ok: false,
          error: "You don't have permission to change what the client sees.",
        };
  }

  const workspaceSlug = authz.access.workspaceSlug;

  // F004c (item 6): the parent-page lookup now runs AFTER the permission
  // check (previously it ran before, doing an extra query even for a
  // caller who was about to be rejected anyway) and ONLY when this call is
  // actually sharing the section (`visible === true`) -- unsharing never
  // needs the "page is still hidden" hint, since that hint only matters
  // for a newly-shared section. A soft-deleted parent page is excluded
  // (`.is("deleted_at", null)`) so a page that's been trashed is never
  // treated as "hidden but shareable" -- it should read the same as "no
  // parent page found" (pageHidden: false). A lookup error is logged
  // rather than silently treated as "not hidden", so an operator can tell
  // a genuine DB failure apart from a page that's simply visible.
  let pageHidden = false;
  if (parsed.data.visible) {
    const { data: parentPageRow, error: parentPageError } = await admin
      .from("tasks")
      .select("client_visible")
      .eq("id", taskRow.parent_task_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (parentPageError) {
      logger.error("setSectionClientVisibility: parent page lookup failed (non-fatal)", {
        error: parentPageError,
      });
    } else if (parentPageRow) {
      pageHidden = !parentPageRow.client_visible;
    }
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ client_visible: parsed.data.visible })
    .eq("id", parsed.data.taskId);

  if (updateError) {
    logger.error("setSectionClientVisibility: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("setSectionClientVisibility: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (workspaceSlug) {
    revalidatePortalProject(workspaceSlug, taskRow.project_id);
  }

  return {
    ok: true,
    data: {
      taskId: parsed.data.taskId,
      clientVisible: parsed.data.visible,
      pageHidden,
    },
  };
}

// Mission 20260919-150607, F003 (AS-015..AS-021): changes a section's
// `section_kind` ('static' | 'cms', tasks_section_kind_check). Sibling of
// changePageKind above -- same "resolve workspace server-side from the
// task row, re-check membership + write access, then a single targeted
// UPDATE" shape -- with two deltas the clarified spec calls for:
//
// 1. The "confirm it's actually a page" guard changePageKind has
//    (`taskRow.page_slug` truthy) becomes "confirm it's actually a
//    section" here: `section_kind IS NOT NULL` is the column's own
//    definition of "this task participates in section-kind at all"
//    (only sections get a non-null value -- pages and plain tasks never
//    do), so AS-017 (a non-section task is rejected) falls out of the
//    same not-found-shaped guard changePageKind uses for AS-018's page
//    analogue, not a bespoke check.
// 2. A `writeAudit` call on success (AS-020) -- changePageKind predates
//    F140's audit log and was never backfilled; this new action doesn't
//    repeat that gap. `writeAudit` needs the session-bound client (its
//    own header comment: the `write_audit_log_entry` RPC pins actor_id
//    to `auth.uid()`), which is exactly what `getCurrentUser()` already
//    returned above -- no second client construction.
//
// AS-018 (a task from a different project is rejected): this action
// takes no `projectId` argument (clarified API: `changeSectionKind(taskId,
// kind)`), so "different project" can only ever mean "a project outside
// a project this caller may write" -- the project is resolved from the
// task row itself (never trusted from the caller), so
// authorizeArchitectureProject below is the enforcement point for that
// case, same as every other task-scoped action in this file.
//
// AS-021 (idempotent): re-applying the same kind short-circuits before the
// UPDATE and the audit write (see the `taskRow.section_kind ===
// parsed.data.kind` check below) -- a no-op call returns `{ success: true }`
// without touching the DB or writing a duplicate audit entry (AS-020).
export async function changeSectionKind(
  taskId: string,
  kind: string,
): Promise<MutationResult> {
  const parsed = changeSectionKindSchema.safeParse({ taskId, kind });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid section kind.",
    };
  }

  const { user, supabase } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to change a section's kind." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Look up the task's owning project/workspace server-side, and confirm
  // it is actually a section (parent_task_id IS NOT NULL -- section_kind
  // is NOT NULL DEFAULT 'static' on every task row, so it can never be
  // used to distinguish a section from a plain task; parent_task_id is
  // the real "is this a section" predicate, same as every other action in
  // this file) before touching it.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, project_id, page_slug, section_kind, parent_task_id, projects(workspace_id, workspaces(slug))",
    )
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    taskError ||
    !taskRow ||
    !taskRow.parent_task_id ||
    !(taskRow as { projects?: { workspace_id?: string } }).projects?.workspace_id
  ) {
    return { success: false, error: "Section not found." };
  }

  if (!(await areArchitectureSections(admin, [taskRow]))) {
    return { success: false, error: "Section not found." };
  }

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to change this section's kind.",
    };
  }

  const workspaceId = authz.access.workspaceId;
  const changeSectionKindWorkspaceSlug = authz.access.workspaceSlug;

  // AS-020 (scrutiny remediation): a no-op call (kind already matches) is
  // short-circuited before the UPDATE and audit write below -- otherwise a
  // repeated call with the same kind fires an unnecessary UPDATE and, worse,
  // a duplicate audit entry that misrepresents the section's kind as having
  // just changed when it did not.
  if (taskRow.section_kind === parsed.data.kind) {
    return { success: true };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ section_kind: parsed.data.kind })
    .eq("id", parsed.data.taskId);

  if (updateError) {
    logger.error("changeSectionKind: update failed", { error: updateError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await writeAudit(supabase, {
    workspaceId,
    action: "section.kind_changed",
    targetType: "task",
    targetId: parsed.data.taskId,
    metadata: { projectId: taskRow.project_id, kind: parsed.data.kind },
  });

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("changeSectionKind: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (changeSectionKindWorkspaceSlug) {
    revalidatePortalProject(changeSectionKindWorkspaceSlug, taskRow.project_id);
  }

  return { success: true };
}
