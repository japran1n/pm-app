"use server";

// Mission 20260918-architecture-enrichment, F13: server actions writing the
// enrichment fields (intent, audience, primary CTA, tone, keywords, copy
// status) and the client-visibility flag for a page/section node's meta
// row in `architecture_node_meta`. Auth chain mirrors createSection /
// renameSection in lib/actions/architecture/sections.ts: resolve the
// current user, look up the task's owning project/workspace server-side
// (never trust a client-supplied project id), confirm active membership,
// then require write permission before touching data.
import { revalidatePath } from "next/cache";

import { type z } from "zod";

import { logger } from "@/lib/observability/logger";
import {
  revalidatePortalProject,
  extractWorkspaceSlug,
} from "@/lib/actions/portal-revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite } from "@/lib/auth/permissions";
import {
  setNodeMetaSchema,
  setNodeMetaClientVisibilitySchema,
  copyStatusSchema,
} from "@/lib/validation/architecture";

import type { MutationResult } from "./shared";

type CopyStatus = z.infer<typeof copyStatusSchema>;

// Shared helper: resolve the task's owning project + workspace, and
// confirm the caller is an active, write-capable member -- same convention
// as sections.ts. Returns the project id and workspace slug on success.
async function resolveTaskAndAuthorizeWrite(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
  userId: string,
): Promise<
  | { ok: true; projectId: string; workspaceSlug: string | undefined }
  | { ok: false; error: string }
> {
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, projects(workspace_id, workspaces(slug))")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    taskError ||
    !taskRow ||
    !(taskRow as { projects?: { workspace_id?: string } }).projects
      ?.workspace_id
  ) {
    return { ok: false, error: "Not found." };
  }

  const projects = (
    taskRow as {
      projects: {
        workspace_id: string;
        workspaces: { slug: string } | { slug: string }[] | null;
      };
    }
  ).projects;
  const workspaceId = projects.workspace_id;
  const workspaceSlug = extractWorkspaceSlug(projects.workspaces);

  const membership = await requireActiveMembership(admin, workspaceId, userId);

  if (!membership.ok) {
    return { ok: false, error: "Not found." };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to make this change.",
    };
  }

  return { ok: true, projectId: taskRow.project_id, workspaceSlug };
}

export async function setNodeMeta(
  taskId: string,
  patch: {
    intent?: string;
    audience?: string;
    primaryCta?: string;
    tone?: string;
    keywords?: string[];
    copyStatus?: CopyStatus;
  },
): Promise<MutationResult> {
  const parsed = setNodeMetaSchema.safeParse({ taskId, patch });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to do this." };
  }

  const admin = createAdminClient();

  const authz = await resolveTaskAndAuthorizeWrite(admin, parsed.data.taskId, user.id);

  if (!authz.ok) {
    return { success: false, error: authz.error };
  }

  const normalizedKeywords =
    parsed.data.patch.keywords !== undefined
      ? [
          ...new Set(
            parsed.data.patch.keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0),
          ),
        ].slice(0, 30)
      : undefined;

  const { error: upsertError } = await admin.from("architecture_node_meta").upsert(
    {
      task_id: parsed.data.taskId,
      project_id: authz.projectId,
      ...(parsed.data.patch.intent !== undefined && {
        intent: parsed.data.patch.intent || null,
      }),
      ...(parsed.data.patch.audience !== undefined && {
        audience: parsed.data.patch.audience || null,
      }),
      ...(parsed.data.patch.primaryCta !== undefined && {
        primary_cta: parsed.data.patch.primaryCta || null,
      }),
      ...(parsed.data.patch.tone !== undefined && {
        tone: parsed.data.patch.tone || null,
      }),
      ...(normalizedKeywords !== undefined && { keywords: normalizedKeywords }),
      ...(parsed.data.patch.copyStatus !== undefined && {
        copy_status: parsed.data.patch.copyStatus,
      }),
      updated_by: user.id,
    },
    { onConflict: "task_id" },
  );

  if (upsertError) {
    logger.error("setNodeMeta: upsert failed", { error: upsertError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("setNodeMeta: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

export async function setNodeMetaClientVisibility(
  taskId: string,
  visible: boolean,
): Promise<MutationResult> {
  const parsed = setNodeMetaClientVisibilitySchema.safeParse({ taskId, visible });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to do this." };
  }

  const admin = createAdminClient();

  const authz = await resolveTaskAndAuthorizeWrite(admin, parsed.data.taskId, user.id);

  if (!authz.ok) {
    return { success: false, error: authz.error };
  }

  const { error: upsertError } = await admin.from("architecture_node_meta").upsert(
    {
      task_id: parsed.data.taskId,
      project_id: authz.projectId,
      client_visible: parsed.data.visible,
      updated_by: user.id,
    },
    { onConflict: "task_id" },
  );

  if (upsertError) {
    logger.error("setNodeMetaClientVisibility: upsert failed", { error: upsertError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("setNodeMetaClientVisibility: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (authz.workspaceSlug) {
    revalidatePortalProject(authz.workspaceSlug, authz.projectId);
  }

  return { success: true };
}
