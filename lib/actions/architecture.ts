"use server";

// Mission 20260910-182104, F010 (AS-001, AS-002, AS-031, AS-037): write
// side for the architecture board's "create page" action. Standing
// decision 1 (clarifications/standing-decisions.md): a page IS a task
// with `page_slug` set and the workspace's `page` task type -- no
// parallel entity, ever -- so `createPage` is a thin, page-specific
// wrapper around the same `tasks` insert createTaskForUser
// (lib/tasks/create.ts) already performs, not a second creation path.
//
// Pattern mirrors lib/actions/tasks.ts's createTask / lib/tasks/create.ts:
// Zod-validated input (AS-039), membership + write permission re-checked
// server-side (defense in depth), an admin client for the actual insert
// once membership is independently verified, discriminated-union return,
// generic user-facing errors with details only logged server-side.
//
// Unlike createTask, this action takes only `projectId` -- not a
// caller-supplied `workspaceId` -- because the project's owning workspace
// is looked up server-side (`projects.workspace_id`) so membership is
// always checked against the *real* workspace, never one a client could
// pass in. (F010's spec sketch names a `workspaceId` parameter; this
// action intentionally does not accept one from the caller for the same
// "never trust a workspace id supplied by the client" reason
// createTaskForUser's own header comment gives -- see this feature's
// handoff, "Decisions made".)
import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite } from "@/lib/auth/permissions";
import {
  createPageSchema,
  createSectionSchema,
  type CreatePageInput,
} from "@/lib/validation/architecture";
import { z } from "zod";

export type CreatePageResult =
  | {
      ok: true;
      data: {
        id: string;
        projectId: string;
        title: string;
        pageSlug: string;
        pageKind: string;
        position: number;
      };
    }
  | { ok: false; error: string };

// AS-001/AS-002/AS-031/AS-037: creates a task carrying `page_slug` (AS-001),
// the workspace's `page` system task type (AS-002), `page_kind = 'static'`
// by default (AS-031), placed at the end of the project's existing page
// column order (AS-037).
export async function createPage(
  projectId: string,
  data: CreatePageInput,
): Promise<CreatePageResult> {
  const parsed = createPageSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid page name.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to create a page." };
  }

  const admin = createAdminClient();

  // Look up the project's owning workspace server-side -- never trust a
  // workspace id supplied by the client -- same convention
  // createTaskForUser's project lookup uses (lib/tasks/create.ts).
  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id, deleted_at")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (projectError || !projectRow) {
    return { ok: false, error: "Project not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    projectRow.workspace_id,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to create a page in this project.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to create pages.",
    };
  }

  // AS-002: resolve (or lazily create, for a workspace that predates the
  // 'page' seed) the workspace's own `page` task type, via the same
  // `ensure_task_type` helper the generic task-creation path uses for its
  // `delivery` default -- see supabase/migrations/
  // 20261104040000_f116_self_healing_system_type_lookup.sql. Name/color
  // match the original seed (20260912010000_task_type_system_key.sql /
  // 20261104010000_f116_task_type_taxonomy.sql: 'Page', '#3670e1').
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
    logger.error("createPage: failed to resolve 'page' task type", {
      error: ensureError,
    });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // AS-037: append to the end of this project's existing page order --
  // the current page count for this project, using the exact "a page IS
  // a task with page_slug set and parent_task_id null" shape
  // lib/queries/architecture.ts's buildBoardFromRows filters on, so the
  // new page always sorts after every existing one.
  const { count: existingPageCount, error: countError } = await admin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("parent_task_id", null)
    .is("deleted_at", null)
    .not("page_slug", "is", null);

  if (countError) {
    logger.error("createPage: failed to count existing pages", {
      error: countError,
    });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const newPosition = (existingPageCount ?? 0) + 1;

  const { data: inserted, error: insertError } = await admin
    .from("tasks")
    .insert({
      project_id: projectId,
      title: parsed.data.name,
      page_slug: parsed.data.slug,
      page_kind: parsed.data.page_kind,
      task_type_id: pageTaskTypeId,
      author_id: user.id,
      position: newPosition,
      parent_task_id: null,
    })
    .select("id, project_id, title, page_slug, page_kind, position")
    .single();

  if (insertError || !inserted) {
    logger.error("createPage: insert failed", { error: insertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("createPage: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      projectId: inserted.project_id,
      title: inserted.title,
      pageSlug: inserted.page_slug as string,
      pageKind: inserted.page_kind as string,
      position: inserted.position,
    },
  };
}

// AS-032: a page's kind can be changed after creation. Same
// membership/permission re-check as createPage -- a page is a task, so
// this is a targeted update of that task's `page_kind` column, scoped by
// the task's owning workspace (looked up server-side, never trusted from
// the client).
export async function changePageKind(
  taskId: string,
  kind: "static" | "cms" | "utility",
): Promise<{ success: boolean; error?: string }> {
  if (kind !== "static" && kind !== "cms" && kind !== "utility") {
    return { success: false, error: "Invalid page kind." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in to change a page's kind." };
  }

  const admin = createAdminClient();

  // Look up the task's owning project/workspace server-side, and confirm
  // it is actually a page (page_slug set), before touching it.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, projects(workspace_id)")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    taskError ||
    !taskRow ||
    !taskRow.page_slug ||
    !(taskRow as { projects?: { workspace_id?: string } }).projects?.workspace_id
  ) {
    return { success: false, error: "Page not found." };
  }

  const workspaceId = (taskRow as { projects: { workspace_id: string } }).projects
    .workspace_id;

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to change this page's kind.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to change a page's kind.",
    };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ page_kind: kind })
    .eq("id", taskId);

  if (updateError) {
    logger.error("changePageKind: update failed", { error: updateError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("changePageKind: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

// Mission 20260910-182104, F014 (AS-006, AS-033, AS-039): renames a page
// inline on the board. A page IS a task (standing decision 1), so renaming
// a page is a targeted update of that task's `title` column -- the exact
// column the task list view reads for its title (AS-006 falls out for
// free from that shared column). Same membership/permission re-check and
// "confirm it's actually a page" guard as changePageKind.
export async function renamePage(
  taskId: string,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  // AS-039: a page cannot be saved with an empty name.
  const parsed = z
    .string()
    .trim()
    .min(1, "Page name is required.")
    .max(200, "Page name must be 200 characters or fewer.")
    .safeParse(name);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Page name is required.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in to rename a page." };
  }

  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, projects(workspace_id)")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    taskError ||
    !taskRow ||
    !taskRow.page_slug ||
    !(taskRow as { projects?: { workspace_id?: string } }).projects?.workspace_id
  ) {
    return { success: false, error: "Page not found." };
  }

  const workspaceId = (taskRow as { projects: { workspace_id: string } }).projects
    .workspace_id;

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to rename this page.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to rename a page.",
    };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ title: parsed.data })
    .eq("id", taskId);

  if (updateError) {
    logger.error("renamePage: update failed", { error: updateError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("renamePage: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

// Mission 20260910-182104, F018 (AS-008, AS-036): deletes a page and, in
// the same atomic operation, its sections. A page is a task (page_slug
// set); a section is a task with `parent_task_id` set to the page's id
// (F008/F013). Rather than issuing two separate `.update()` calls from
// here -- two network round trips, not atomic -- this reuses the existing
// `cascade_delete_task` RPC (supabase/migrations/
// 20260819071821_subtask_cascade_delete.sql, F149) that already
// soft-deletes a task AND all of its currently-live direct children in a
// single SECURITY DEFINER PL/pgSQL transaction, stamping each cascaded
// child's `deleted_via_task_id`. That RPC has no notion of "page" or
// "section" -- it operates purely on `parent_task_id`, which is exactly
// the relationship a page/section pair already has -- so no new RPC is
// needed for AS-008's cascade guarantee, and every existing board query
// that filters `deleted_at is null` (lib/queries/architecture.ts) already
// stops showing both the page and its sections the instant this commits.
export async function deletePage(
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in to delete a page." };
  }

  const admin = createAdminClient();

  // Look up the task's owning project/workspace server-side, and confirm
  // it is actually a page (page_slug set) before touching it -- same
  // convention as changePageKind/renamePage above.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, projects(workspace_id)")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    taskError ||
    !taskRow ||
    !taskRow.page_slug ||
    !(taskRow as { projects?: { workspace_id?: string } }).projects?.workspace_id
  ) {
    return { success: false, error: "Page not found." };
  }

  const workspaceId = (taskRow as { projects: { workspace_id: string } }).projects
    .workspace_id;

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to delete this page.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to delete a page.",
    };
  }

  const { data: cascadeResult, error: cascadeError } = await admin.rpc(
    "cascade_delete_task",
    { p_task_id: taskId },
  );

  if (cascadeError || !cascadeResult) {
    logger.error("deletePage: cascade_delete_task failed", {
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
    logger.error("deletePage: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

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
): Promise<{ success: boolean; error?: string; id?: string }> {
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
): Promise<{ success: boolean; error?: string }> {
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
