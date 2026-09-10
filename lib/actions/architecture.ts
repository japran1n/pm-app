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
import { createPageSchema, type CreatePageInput } from "@/lib/validation/architecture";

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
