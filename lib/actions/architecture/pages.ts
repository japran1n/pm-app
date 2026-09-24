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
import { revalidatePortalProject } from "@/lib/actions/portal-revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { BoardPageKind } from "@/lib/queries/architecture";
import {
  createPageSchema,
  pageKindEnum,
  changePageSlugSchema,
  type CreatePageInput,
} from "@/lib/validation/architecture";
import { z } from "zod";

import type { MutationResult } from "./shared";
import {
  authorizeArchitectureProject,
  authorizeArchitectureProjects,
} from "./authorize";
import type { ActionResult } from "@/lib/actions/authz";

export type CreatePageResult = ActionResult<{
        id: string;
        projectId: string;
        title: string;
        pageSlug: string;
        pageKind: string;
        position: number;
      }>;

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

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to create a page." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // The project's owning workspace is looked up server-side -- never
  // trust a workspace id supplied by the client.
  const authz = await authorizeArchitectureProject(admin, user.id, projectId);

  if (!authz.ok) {
    return authz.reason === "not_found"
      ? { ok: false, error: "Project not found." }
      : {
          ok: false,
          error: "You don't have permission to create a page in this project.",
        };
  }

  const createPageWorkspaceSlug = authz.access.workspaceSlug;

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
      p_workspace_id: authz.access.workspaceId,
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

  if (createPageWorkspaceSlug) {
    revalidatePortalProject(createPageWorkspaceSlug, projectId);
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
): Promise<MutationResult> {
  if (!pageKindEnum.safeParse(kind).success) {
    return { success: false, error: "Invalid page kind." };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to change a page's kind." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Look up the task's owning project/workspace server-side, and confirm
  // it is actually a page (page_slug set), before touching it.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, projects(workspace_id, workspaces(slug))")
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

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to change this page's kind.",
    };
  }

  const changePageKindWorkspaceSlug = authz.access.workspaceSlug;

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

  if (changePageKindWorkspaceSlug) {
    revalidatePortalProject(changePageKindWorkspaceSlug, taskRow.project_id);
  }

  return { success: true };
}

// AS-138/AS-141/AS-142/AS-143/AS-149: a page's slug can be changed after
// creation. Same membership/permission re-check as changePageKind, plus a
// project-scoped uniqueness check (AS-141): two pages in the same project
// cannot share a slug, but the same slug is fine across different
// projects -- identical contract to createPage's slug uniqueness check
// above.
export async function changePageSlug(
  taskId: string,
  newSlug: string,
): Promise<MutationResult> {
  const parsed = changePageSlugSchema.safeParse({ taskId, slug: newSlug });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid page slug.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to change a page's slug." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, projects(workspace_id, workspaces(slug))")
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

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to change this page's slug.",
    };
  }

  const changePageSlugWorkspaceSlug = authz.access.workspaceSlug;

  // AS-141: two pages in the same project cannot share a slug. Scoped to
  // this project only -- same slug in a different project is fine.
  const { data: existingPage, error: existingPageError } = await admin
    .from("tasks")
    .select("id")
    .eq("project_id", taskRow.project_id)
    .eq("page_slug", parsed.data.slug)
    .neq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingPageError) {
    logger.error("changePageSlug: failed to check slug uniqueness", {
      error: existingPageError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (existingPage) {
    return {
      success: false,
      error: "A page with this slug already exists.",
    };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ page_slug: parsed.data.slug })
    .eq("id", taskId);

  if (updateError) {
    logger.error("changePageSlug: update failed", { error: updateError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("changePageSlug: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (changePageSlugWorkspaceSlug) {
    revalidatePortalProject(changePageSlugWorkspaceSlug, taskRow.project_id);
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
): Promise<MutationResult> {
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

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to rename a page." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, projects(workspace_id, workspaces(slug))")
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

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to rename this page.",
    };
  }

  const renamePageWorkspaceSlug = authz.access.workspaceSlug;

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

  if (renamePageWorkspaceSlug) {
    revalidatePortalProject(renamePageWorkspaceSlug, taskRow.project_id);
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
): Promise<MutationResult> {
  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to delete a page." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Look up the task's owning project/workspace server-side, and confirm
  // it is actually a page (page_slug set) before touching it -- same
  // convention as changePageKind/renamePage above.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, projects(workspace_id, workspaces(slug))")
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

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to delete this page.",
    };
  }

  const deletePageWorkspaceSlug = authz.access.workspaceSlug;

  const { data: cascadeResult, error: cascadeError } = await admin.rpc(
    "cascade_delete_task",
    { p_task_id: taskId, p_deleted_by: user.id },
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

  if (deletePageWorkspaceSlug) {
    revalidatePortalProject(deletePageWorkspaceSlug, taskRow.project_id);
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
): Promise<MutationResult> {
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

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to reorder pages." };
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
    return { success: false, error: "Page not found." };
  }

  for (const taskRow of taskRows) {
    if (!taskRow.page_slug || taskRow.parent_task_id !== null) {
      return { success: false, error: "Page not found." };
    }
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
      error: "You don't have permission to reorder these pages.",
    };
  }

  // F004c (AS-006): keyed by projectId, NOT slug — two different projects
  // in the SAME workspace share the same workspace slug.
  const reorderPagesPortalTargets = new Map<string, string>();
  for (const [projectIdForSlug, access] of authz.accessByProject) {
    if (access.workspaceSlug) {
      reorderPagesPortalTargets.set(projectIdForSlug, access.workspaceSlug);
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

  for (const [projectIdForSlug, slug] of reorderPagesPortalTargets) {
    revalidatePortalProject(slug, projectIdForSlug);
  }

  return { success: true };
}

// F003 (missions/20260914-portal-simplify, AS-004, AS-005): "share this
// page with the client" from the Architecture board. A page IS a task
// (standing decision 1), so this reuses the exact same
// `tasks.client_visible` column, membership/permission gate, and
// discriminated-union return shape lib/actions/client-visibility.ts's
// `setTaskClientVisibility` already established for the task detail
// sheet's toggle -- no parallel visibility mechanism for pages/sections.
//
// `includeSections` (offered by the UI when sharing a page that has
// sections, per this feature's clarified spec) additionally flips every
// live section under this page to `client_visible = true` in the same
// action call, so the team doesn't have to re-open each section
// individually right after sharing its page. It is a no-op on unshare --
// hiding a page never touches its sections, so re-sharing later restores
// exactly the section-level choices the team made before.
//
// Looks up the page's owning workspace (and its slug, for the portal
// revalidate below) server-side, never trusting a workspace id supplied
// by the client -- same convention as every other action in this file.
export type SetPageClientVisibilityResult = ActionResult<{
  taskId: string;
  clientVisible: boolean;
  sectionsShared: number;
  sectionsShareFailed?: boolean;
}>;

export async function setPageClientVisibility(
  taskId: string,
  visible: boolean,
  options: { includeSections?: boolean } = {},
): Promise<SetPageClientVisibilityResult> {
  const parsed = z
    .object({ taskId: z.string().uuid("Invalid page."), visible: z.boolean() })
    .safeParse({ taskId, visible });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid page.",
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

  if (
    taskError ||
    !taskRow ||
    !taskRow.page_slug ||
    taskRow.parent_task_id !== null
  ) {
    return { ok: false, error: "Page not found." };
  }

  // Same gate as setTaskClientVisibility (lib/actions/client-visibility.ts):
  // sharing with the client is an edit to the task, so `canEditTask`, plus
  // project visibility since the write below bypasses RLS.
  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
    { writeGate: "task" },
  );

  if (!authz.ok) {
    return authz.reason === "not_found"
      ? { ok: false, error: "Page not found." }
      : {
          ok: false,
          error: "You don't have permission to change what the client sees.",
        };
  }

  const workspaceSlug = authz.access.workspaceSlug;

  const { error: updateError } = await admin
    .from("tasks")
    .update({ client_visible: parsed.data.visible })
    .eq("id", parsed.data.taskId);

  if (updateError) {
    logger.error("setPageClientVisibility: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  let sectionsShared = 0;
  let sectionsShareFailed = false;

  if (parsed.data.visible && options.includeSections) {
    const { data: sectionRows, error: sectionsUpdateError } = await admin
      .from("tasks")
      .update({ client_visible: true })
      .eq("parent_task_id", parsed.data.taskId)
      .eq("project_id", taskRow.project_id)
      .is("page_slug", null)
      .is("deleted_at", null)
      .select("id");

    if (sectionsUpdateError) {
      logger.error("setPageClientVisibility: sections update failed", {
        error: sectionsUpdateError,
      });
      // AS-006/scrutiny remediation: the page's own client_visible update
      // above already committed successfully -- returning ok:false here
      // would falsely tell the caller the whole action failed and the page
      // is still hidden. Instead this is surfaced as a partial failure so
      // the UI can show a warning toast ("Page shared, but its sections
      // could not be shared") while still reporting the page share as a
      // success.
      sectionsShareFailed = true;
    } else {
      sectionsShared = sectionRows?.length ?? 0;
    }
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("setPageClientVisibility: revalidatePath failed (non-fatal)", {
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
      sectionsShared,
      sectionsShareFailed,
    },
  };
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

  const { user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to import a sitemap." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const authz = await authorizeArchitectureProject(admin, user.id, projectId);
  if (!authz.ok) {
    return authz.reason === "not_found"
      ? { ok: false, error: "Project not found." }
      : { ok: false, error: "You don't have permission to import pages into this project." };
  }


  // Same self-healing lookup createPage uses -- resolves (and seeds when
  // absent) the workspace's 'page' task type.
  const { data: pageTaskTypeId, error: ensureError } = await admin.rpc("ensure_task_type", {
    p_workspace_id: authz.access.workspaceId,
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

  // F004c (AS-006): mirrors createPage's own unconditional portal
  // revalidate above — imported pages default `client_visible: false`
  // (same as a single createPage call), but the site map's own layout
  // (unshared pages still occupy slots for the team-visible parts of the
  // Sitemap) is still touched by this write, so this uses the same
  // "always revalidate on any page-creating write" convention as its
  // single-page sibling rather than inventing a client_visible gate this
  // action's sibling doesn't have.
  const importPagesWorkspaceSlug = authz.access.workspaceSlug;
  if (importPagesWorkspaceSlug) {
    revalidatePortalProject(importPagesWorkspaceSlug, projectId);
  }

  return { ok: true, created: rows.length, skipped: pages.length - rows.length };
}
