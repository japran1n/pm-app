"use server";

// F113 (missions/20260903-portal, client-portal-phase-2-plan.md item B):
// team-side CRUD for `page_links` (20261101020000). Mirrors
// lib/actions/project-site.ts's `project_links` actions exactly:
// withAuthz's default `canWrite` gate, ctx.admin for the write with RLS
// as the backstop (every INSERT/UPDATE/DELETE policy on `page_links` is
// gated on `is_project_workspace_writer` via the parent task's project,
// 20261101020000), writeAudit for the audit trail. No reorder action --
// a page's own three-ish links don't need manual ordering the way a
// project's dozen links do; they render fixed-order by kind
// (components/task/page-links-editor.tsx).

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { withAuthz } from "@/lib/actions/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/activity/audit";
import {
  createPageLinkSchema,
  updatePageLinkSchema,
  deletePageLinkSchema,
} from "@/lib/validation/page-links";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import { getPageLinksForTask, type PageLink, type PageLinkKind } from "@/lib/queries/page-links";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

type AdminClient = ReturnType<typeof createAdminClient>;

type TaskExtra = { projectId: string; workspaceSlug: string; taskId: string };

async function loadTaskExtra(
  admin: AdminClient,
  taskId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: TaskExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("tasks")
    .select(
      "id, project_id, deleted_at, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", taskId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return { ok: false, error: "Page not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Page not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Page not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, taskId: data.id },
  };
}

type LinkExtra = TaskExtra & { linkLabel: string };

async function loadPageLinkExtra(
  admin: AdminClient,
  linkId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: LinkExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("page_links")
    .select(
      "id, task_id, label, tasks!inner(id, deleted_at, project_id, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug)))",
    )
    .eq("id", linkId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Link not found." };
  }

  const task = Array.isArray(data.tasks) ? data.tasks[0] : data.tasks;
  if (!task || task.deleted_at) {
    return { ok: false, error: "Link not found." };
  }

  const project = Array.isArray(task.projects) ? task.projects[0] : task.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Link not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Link not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: {
      projectId: project.id,
      workspaceSlug,
      taskId: task.id,
      linkLabel: data.label,
    },
  };
}

async function revalidateTaskViews(workspaceSlug: string, projectId: string, taskId: string) {
  try {
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}`, "layout");
    revalidatePath(`/portal/${workspaceSlug}/p/${projectId}/pages`, "page");
    revalidatePath(`/portal/${workspaceSlug}/p/${projectId}/t/${taskId}`, "page");
  } catch (revalidateError) {
    logger.error("page-links: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

const AUTHZ_ERRORS = {
  membershipError: "You don't have permission to manage this page's links.",
  writeError: "Viewers don't have permission to manage this page's links.",
  visibilityError: "You don't have permission to manage this page's links.",
};

export type PageLinkActionResult =
  | { ok: true; data: PageLink }
  | { ok: false; error: string };

const PAGE_LINK_COLUMNS = "id, task_id, kind, label, url, client_visible, position";

function toPageLink(row: {
  id: string;
  task_id: string;
  kind: string;
  label: string;
  url: string;
  client_visible: boolean;
  position: number;
}): PageLink {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind as PageLinkKind,
    label: row.label,
    url: row.url,
    clientVisible: row.client_visible,
    position: row.position,
  };
}

const createPageLinkImpl = withAuthz(
  createPageLinkSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadTaskExtra(admin, input.taskId),
  },
  async (input, ctx): Promise<PageLinkActionResult> => {
    const { data: last } = await ctx.admin
      .from("page_links")
      .select("position")
      .eq("task_id", ctx.taskId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = ((last as { position: number } | null)?.position ?? 0) + 1;

    const { data: inserted, error } = await ctx.admin
      .from("page_links")
      .insert({
        task_id: ctx.taskId,
        kind: input.kind,
        label: input.label,
        url: input.url,
        client_visible: input.clientVisible ?? false,
        position: newPosition,
      })
      .select(PAGE_LINK_COLUMNS)
      .single();

    if (error || !inserted) {
      logger.error("createPageLink: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "page_link.created",
      targetType: "page_link",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, taskId: ctx.taskId, label: inserted.label },
    });

    await revalidateTaskViews(ctx.workspaceSlug, ctx.projectId, ctx.taskId);
    return { ok: true, data: toPageLink(inserted) };
  },
);

export async function createPageLink(input: {
  taskId: string;
  kind: PageLinkKind;
  label: string;
  url: string;
  clientVisible?: boolean;
}): Promise<PageLinkActionResult> {
  return createPageLinkImpl(input);
}

const updatePageLinkImpl = withAuthz(
  updatePageLinkSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadPageLinkExtra(admin, input.linkId),
  },
  async (input, ctx): Promise<PageLinkActionResult> => {
    const { data: updated, error } = await ctx.admin
      .from("page_links")
      .update({
        kind: input.kind,
        label: input.label,
        url: input.url,
        client_visible: input.clientVisible,
      })
      .eq("id", input.linkId)
      .select(PAGE_LINK_COLUMNS)
      .single();

    if (error || !updated) {
      logger.error("updatePageLink: update failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "page_link.updated",
      targetType: "page_link",
      targetId: updated.id,
      metadata: { projectId: ctx.projectId, taskId: ctx.taskId, label: updated.label },
    });

    await revalidateTaskViews(ctx.workspaceSlug, ctx.projectId, ctx.taskId);
    return { ok: true, data: toPageLink(updated) };
  },
);

export async function updatePageLink(input: {
  linkId: string;
  kind: PageLinkKind;
  label: string;
  url: string;
  clientVisible: boolean;
}): Promise<PageLinkActionResult> {
  return updatePageLinkImpl(input);
}

export type DeletePageLinkResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

const deletePageLinkImpl = withAuthz(
  deletePageLinkSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadPageLinkExtra(admin, input.linkId),
  },
  async (input, ctx): Promise<DeletePageLinkResult> => {
    const { error } = await ctx.admin.from("page_links").delete().eq("id", input.linkId);

    if (error) {
      logger.error("deletePageLink: delete failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "page_link.deleted",
      targetType: "page_link",
      targetId: input.linkId,
      metadata: { projectId: ctx.projectId, taskId: ctx.taskId, label: ctx.linkLabel },
    });

    await revalidateTaskViews(ctx.workspaceSlug, ctx.projectId, ctx.taskId);
    return { ok: true, data: { id: input.linkId } };
  },
);

export async function deletePageLink(linkId: string): Promise<DeletePageLinkResult> {
  return deletePageLinkImpl({ linkId });
}

// Team-side read for the task detail sheet's own editor -- unfiltered by
// client_visible (same convention as getProjectLinks). Not a Server
// Action mutation, but exported alongside these for the client component
// that needs it to call in one place; matches getProjectPhaseOptions's
// own "action-shaped read called from a Client Component" precedent in
// components/task/task-detail-sheet.tsx.
export async function getPageLinksForTaskAction(taskId: string): Promise<{
  ok: true;
  data: PageLink[];
} | { ok: false; error: string }> {
  return getPageLinksForTask(taskId);
}
