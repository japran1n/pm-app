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
import type { BoardPageKind } from "@/lib/queries/architecture";
import {
  createPageSchema,
  pageKindEnum,
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

  // AS-017: two pages in the same project cannot share a slug. Checked
  // server-side (defense in depth against a stale client/race), scoped to
  // this project only -- same slug in a different project is fine.
  const { data: existingPage, error: existingPageError } = await admin
    .from("tasks")
    .select("id")
    .eq("project_id", projectId)
    .eq("page_slug", parsed.data.slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingPageError) {
    logger.error("createPage: failed to check slug uniqueness", {
      error: existingPageError,
    });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (existingPage) {
    return {
      ok: false,
      error: "A page with this slug already exists.",
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
  kind: BoardPageKind,
): Promise<{ success: boolean; error?: string }> {
  if (!pageKindEnum.safeParse(kind).success) {
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
): Promise<{ success: boolean; error?: string }> {
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
): Promise<{ success: boolean; error?: string }> {
  if (typeof sectionTaskId !== "string" || !sectionTaskId) {
    return { success: false, error: "Invalid section." };
  }

  if (typeof newPageTaskId !== "string" || !newPageTaskId) {
    return { success: false, error: "Invalid destination page." };
  }

  if (typeof position !== "number" || !Number.isFinite(position)) {
    return { success: false, error: "Invalid position." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

// Mission 20260910-182104, F022 (AS-046, AS-047): reorders the page
// columns themselves on the Architecture board. A page IS a task with
// `page_slug` set (standing decision 1), so this is the same batched
// `position` update reorderSections already performs for sections --
// mirrored here for the page-task rows instead of the section-task rows.
// Every id in `updates` must resolve to a live page task (page_slug set)
// whose owning workspace the caller is an active, write-capable member
// of; if any single id fails that check the whole batch is rejected
// rather than partially applied, same convention as reorderSections.
export async function reorderPages(
  updates: { id: string; position: number }[],
): Promise<{ success: boolean; error?: string }> {
  if (!Array.isArray(updates) || updates.length === 0) {
    return { success: false, error: "No pages to reorder." };
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in to reorder pages." };
  }

  const admin = createAdminClient();

  const ids = updates.map((update) => update.id);

  const { data: taskRows, error: taskError } = await admin
    .from("tasks")
    .select("id, page_slug, projects(workspace_id)")
    .in("id", ids)
    .is("deleted_at", null);

  if (taskError || !taskRows || taskRows.length !== ids.length) {
    return { success: false, error: "Page not found." };
  }

  const membershipCache = new Map<string, boolean>();

  for (const taskRow of taskRows) {
    if (!taskRow.page_slug) {
      return { success: false, error: "Page not found." };
    }

    const workspaceId = (taskRow as { projects?: { workspace_id?: string } })
      .projects?.workspace_id;

    if (!workspaceId) {
      return { success: false, error: "Page not found." };
    }

    if (!membershipCache.has(workspaceId)) {
      const membership = await requireActiveMembership(admin, workspaceId, user.id);
      const allowed = membership.ok && canWrite({ role: membership.role });
      membershipCache.set(workspaceId, allowed);
    }

    if (!membershipCache.get(workspaceId)) {
      return {
        success: false,
        error: "You don't have permission to reorder these pages.",
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
    logger.error("reorderPages: update failed", { error: failed.error });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("reorderPages: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

// Mission 20260910-182104, F025 (AS-051, AS-052): turns an existing
// section into a component. A section IS a subtask (standing decision 1);
// "turning it into a component" means creating a `page_components` row
// named after the section's own title (AS-052) and linking it back via
// the same `tasks.component_id` column every other section-component
// link uses (F008/F033 etc already read this column), so the section
// card immediately shows the new component name for free.
//
// Guards against creating a duplicate component for a section that is
// already linked -- returns a generic error rather than silently
// creating a second, orphaned component.
export async function createComponentFromSection(
  sectionTaskId: string,
  projectId: string,
): Promise<{ success: boolean; error?: string; componentId?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to create a component.",
    };
  }

  const admin = createAdminClient();

  // Look up the section's owning project/workspace server-side (never
  // trust the caller-supplied projectId for permission checks -- only for
  // scoping the new component row once membership against the *real*
  // workspace is confirmed), and confirm it is actually a section (has a
  // parent page, no page_slug of its own) before touching it -- same
  // convention as deleteSection/renameSection above.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, project_id, title, page_slug, parent_task_id, component_id, projects(workspace_id)",
    )
    .eq("id", sectionTaskId)
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

  if (taskRow.project_id !== projectId) {
    return { success: false, error: "Section not found." };
  }

  if (taskRow.component_id) {
    return {
      success: false,
      error: "Section already linked to a component",
    };
  }

  const workspaceId = (taskRow as { projects: { workspace_id: string } }).projects
    .workspace_id;

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to create a component in this project.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to create a component.",
    };
  }

  // AS-065: two components in the same project cannot share a
  // case-insensitive name (page_components_project_id_lower_name_idx,
  // supabase/migrations/20261121010000_f002_page_components.sql).
  // Section titles aren't guaranteed unique, so this can legitimately
  // collide -- surfaced as a normal error rather than a 500.
  const { count: existingComponentCount, error: countError } = await admin
    .from("page_components")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (countError) {
    logger.error("createComponentFromSection: failed to count components", {
      error: countError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: insertedComponent, error: insertError } = await admin
    .from("page_components")
    .insert({
      project_id: projectId,
      name: taskRow.title,
      position: (existingComponentCount ?? 0) + 1,
    })
    .select("id")
    .single();

  if (insertError || !insertedComponent) {
    if (insertError?.code === "23505") {
      return {
        success: false,
        error: "A component with this name already exists.",
      };
    }

    logger.error("createComponentFromSection: insert failed", {
      error: insertError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ component_id: insertedComponent.id })
    .eq("id", sectionTaskId);

  if (updateError) {
    logger.error("createComponentFromSection: link update failed", {
      error: updateError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("createComponentFromSection: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true, componentId: insertedComponent.id };
}

// Mission 20260910-182104, F025 (AS-065, AS-066): general-purpose
// component creation, independent of any section. Same
// membership/permission re-check and append-to-end position convention
// as createPage.
export async function createComponent(
  projectId: string,
  name: string,
): Promise<{ success: boolean; error?: string; id?: string }> {
  // AS-066: a component cannot be created with an empty name.
  const parsed = z
    .string()
    .trim()
    .min(1, "Component name is required.")
    .max(200, "Component name must be 200 characters or fewer.")
    .safeParse(name);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Component name is required.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to create a component.",
    };
  }

  const admin = createAdminClient();

  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
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
      error: "You don't have permission to create a component in this project.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to create a component.",
    };
  }

  const { count: existingComponentCount, error: countError } = await admin
    .from("page_components")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (countError) {
    logger.error("createComponent: failed to count components", {
      error: countError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // AS-065: unique(project_id, lower(name)) -- enforced by
  // page_components_project_id_lower_name_idx
  // (supabase/migrations/20261121010000_f002_page_components.sql).
  const { data: inserted, error: insertError } = await admin
    .from("page_components")
    .insert({
      project_id: projectId,
      name: parsed.data,
      position: (existingComponentCount ?? 0) + 1,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return {
        success: false,
        error: "A component with this name already exists.",
      };
    }

    logger.error("createComponent: insert failed", { error: insertError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("createComponent: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true, id: inserted.id };
}

// Mission 20260910-182104, F026 (AS-053, AS-062, AS-067, AS-068): links an
// existing component to a section. AS-062 (a section can only have one
// component) falls out for free from `tasks.component_id` being a single
// nullable column -- this update always replaces whatever was there
// before, there is no separate join table to dedupe.
export async function linkComponentToSection(
  sectionTaskId: string,
  componentId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to link a component.",
    };
  }

  const admin = createAdminClient();

  const { data: sectionRow, error: sectionError } = await admin
    .from("tasks")
    .select("id, project_id")
    .eq("id", sectionTaskId)
    .maybeSingle();

  if (sectionError || !sectionRow) {
    return { success: false, error: "Section not found." };
  }

  const { data: componentRow, error: componentError } = await admin
    .from("page_components")
    .select("id, project_id")
    .eq("id", componentId)
    .maybeSingle();

  if (componentError || !componentRow) {
    return { success: false, error: "Component not found." };
  }

  if (componentRow.project_id !== sectionRow.project_id) {
    return {
      success: false,
      error: "Component does not belong to this project.",
    };
  }

  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id")
    .eq("id", sectionRow.project_id)
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
      error: "You don't have permission to link a component in this project.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to link a component.",
    };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ component_id: componentId })
    .eq("id", sectionTaskId);

  if (updateError) {
    logger.error("linkComponentToSection: update failed", {
      error: updateError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("linkComponentToSection: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}


// Mission 20260910-182104, F028 (AS-057): renames a component. Sections
// join to `page_components.name` via `tasks.component_id` (F026/F027) --
// there is no per-instance copy of the name anywhere -- so this update is
// the entire propagation mechanism: every section that links to this
// component id renders the new name the next time `getArchitectureBoard`
// (lib/queries/architecture.ts) is read, with no additional writes needed.
export async function renameComponent(
  componentId: string,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  // AS-066: a component cannot be renamed to an empty name.
  const parsed = z
    .string()
    .trim()
    .min(1, "Component name is required.")
    .max(200, "Component name must be 200 characters or fewer.")
    .safeParse(name);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Component name is required.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to rename a component.",
    };
  }

  const admin = createAdminClient();

  const { data: componentRow, error: componentError } = await admin
    .from("page_components")
    .select("id, project_id, projects(workspace_id)")
    .eq("id", componentId)
    .maybeSingle();

  if (
    componentError ||
    !componentRow ||
    !(componentRow as { projects?: { workspace_id?: string } }).projects
      ?.workspace_id
  ) {
    return { success: false, error: "Component not found." };
  }

  const workspaceId = (componentRow as { projects: { workspace_id: string } })
    .projects.workspace_id;

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to rename this component.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to rename a component.",
    };
  }

  // AS-065: unique(project_id, lower(name)) -- enforced by
  // page_components_project_id_lower_name_idx
  // (supabase/migrations/20261121010000_f002_page_components.sql).
  const { error: updateError } = await admin
    .from("page_components")
    .update({ name: parsed.data })
    .eq("id", componentId);

  if (updateError) {
    if (updateError.code === "23505") {
      return {
        success: false,
        error: "A component with this name already exists.",
      };
    }

    logger.error("renameComponent: update failed", { error: updateError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("renameComponent: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

// Mission 20260910-182104, F029 (AS-058, AS-059): unlink a single section
// instance from its component without touching any other instance and
// without touching the section's own name.
//
// The update targets exactly one row (`WHERE id = sectionTaskId`), so
// other sections sharing the same `component_id` are never selected or
// written to -- AS-058 falls out of the WHERE clause alone, no extra
// guard needed. `tasks.title` (the section's own name, standing decision
// 8's "local title") is not part of this UPDATE's SET list at all, so it
// is left exactly as it was -- AS-059.
export async function unlinkComponentFromSection(
  sectionTaskId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to unlink a component.",
    };
  }

  const admin = createAdminClient();

  const { data: sectionRow, error: sectionError } = await admin
    .from("tasks")
    .select("id, project_id, projects(workspace_id)")
    .eq("id", sectionTaskId)
    .maybeSingle();

  if (
    sectionError ||
    !sectionRow ||
    !(sectionRow as { projects?: { workspace_id?: string } }).projects
      ?.workspace_id
  ) {
    return { success: false, error: "Section not found." };
  }

  const workspaceId = (sectionRow as { projects: { workspace_id: string } })
    .projects.workspace_id;

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to unlink a component in this project.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to unlink a component.",
    };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ component_id: null })
    .eq("id", sectionTaskId);

  if (updateError) {
    logger.error("unlinkComponentFromSection: update failed", {
      error: updateError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error(
      "unlinkComponentFromSection: revalidatePath failed (non-fatal)",
      { error: revalidateError },
    );
  }

  return { success: true };
}

// Mission 20260910-182104, F030 (AS-060, AS-061): delete a component.
// The `tasks.component_id` foreign key is declared `ON DELETE SET NULL`
// (see the migration that introduced `page_components` / F025), so
// deleting the `page_components` row here is the entire implementation --
// the database itself nulls out `component_id` on every instance
// (AS-061) while leaving those `tasks` rows in place, untouched otherwise
// (AS-060). No application-level cascade/cleanup code is needed or
// wanted; duplicating what the FK already guarantees would just be a
// second place for the two to drift apart.
export async function deleteComponent(
  componentId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to delete a component.",
    };
  }

  const admin = createAdminClient();

  const { data: componentRow, error: componentError } = await admin
    .from("page_components")
    .select("id, project_id, projects(workspace_id)")
    .eq("id", componentId)
    .maybeSingle();

  if (
    componentError ||
    !componentRow ||
    !(componentRow as { projects?: { workspace_id?: string } }).projects
      ?.workspace_id
  ) {
    return { success: false, error: "Component not found." };
  }

  const workspaceId = (componentRow as { projects: { workspace_id: string } })
    .projects.workspace_id;

  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to delete a component in this project.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to delete a component.",
    };
  }

  const { error: deleteError } = await admin
    .from("page_components")
    .delete()
    .eq("id", componentId);

  if (deleteError) {
    logger.error("deleteComponent: delete failed", { error: deleteError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("deleteComponent: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

// Bulk page creation for the Architecture canvas's sitemap import.
//
// Reuses createPage's guard order deliberately -- project lookup, active
// membership, write role -- but resolves them ONCE for the whole batch
// rather than per row, because an import of a real site is routinely 50+
// pages and re-running the membership round trip per page would turn a
// paste into a visible stall.
//
// Slugs already present in the project are skipped rather than rejected,
// so re-importing a sitemap after adding a few pages by hand is a safe,
// idempotent top-up instead of an all-or-nothing failure.
export async function importPages(
  projectId: string,
  pages: { path: string; title: string; kind?: string }[],
): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: string }> {
  if (pages.length === 0) {
    return { ok: false, error: "That file didn't contain any pages." };
  }
  if (pages.length > 500) {
    return { ok: false, error: "That sitemap is too large to import (limit 500 pages)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to import a sitemap." };
  }

  const admin = createAdminClient();

  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id, deleted_at")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (projectError || !projectRow) {
    return { ok: false, error: "Project not found." };
  }

  const membership = await requireActiveMembership(admin, projectRow.workspace_id, user.id);
  if (!membership.ok || !canWrite({ role: membership.role })) {
    return { ok: false, error: "You don't have permission to import pages into this project." };
  }

  // Same self-healing lookup createPage uses -- resolves (and seeds when
  // absent) the workspace's 'page' task type.
  const { data: pageTaskTypeId, error: ensureError } = await admin.rpc("ensure_task_type", {
    p_workspace_id: projectRow.workspace_id,
    p_system_key: "page",
    p_name: "Page",
    p_color: "#3670e1",
    p_is_billable: false,
    p_default_client_visible: false,
  });

  if (ensureError || !pageTaskTypeId) {
    logger.error("importPages: failed to resolve 'page' task type", { error: ensureError });
    return { ok: false, error: "Couldn't import those pages. Please try again." };
  }

  const { data: existingRows } = await admin
    .from("tasks")
    .select("page_slug, position")
    .eq("project_id", projectId)
    .not("page_slug", "is", null)
    .is("deleted_at", null);

  const takenSlugs = new Set((existingRows ?? []).map((row) => row.page_slug));
  const startPosition =
    Math.max(0, ...(existingRows ?? []).map((row) => row.position ?? 0)) + 1;

  const rows = [];
  for (const page of pages) {
    const parsedPage = createPageSchema.safeParse({
      name: page.title,
      slug: page.path,
      page_kind: pageKindEnum.safeParse(page.kind).success ? page.kind : "static",
    });
    if (!parsedPage.success || takenSlugs.has(parsedPage.data.slug)) continue;

    takenSlugs.add(parsedPage.data.slug);
    rows.push({
      project_id: projectId,
      title: parsedPage.data.name,
      page_slug: parsedPage.data.slug,
      page_kind: parsedPage.data.page_kind,
      position: startPosition + rows.length,
      author_id: user.id,
      task_type_id: pageTaskTypeId,
    });
  }

  if (rows.length === 0) {
    return { ok: true, created: 0, skipped: pages.length };
  }

  const { error: insertError } = await admin.from("tasks").insert(rows);
  if (insertError) {
    logger.error("importPages: insert failed", { error: insertError });
    return { ok: false, error: "Couldn't import those pages. Please try again." };
  }

  revalidatePath(`/w/[workspaceSlug]/projects/${projectId}/architecture`, "page");
  return { ok: true, created: rows.length, skipped: pages.length - rows.length };
}
