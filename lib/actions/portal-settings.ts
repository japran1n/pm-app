"use server";

// F080 (missions/20260903-portal, hardening): the two writes that were
// entirely missing before this feature — flipping `projects.portal_enabled`
// (nothing in the app wrote it; only the demo seed script, through the
// admin client, ever set it) and editing the five launch/warranty fields
// the portal's launch-day card renders. Mirrors lib/actions/metrics.ts's
// shape exactly — same `withAuthz` pipeline, same `ctx.admin` for reads
// and `ctx.supabase` for the actual write (see `updateProjectVisibility`,
// lib/actions/project-members.ts, for why the write goes through the
// request-scoped client and not the admin client: `auth.role() =
// 'service_role'` short-circuits `enforce_projects_field_role_allowlist`
// entirely, so writing through `ctx.admin` would silently bypass the very
// owner/admin-only enforcement this feature exists to keep server-side).

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { type ActionResult, withAuthz } from "@/lib/actions/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import { writeAudit } from "@/lib/activity/audit";
import { canManagePortalSettings } from "@/lib/auth/permissions";
import { revalidatePortalProject } from "@/lib/actions/portal-revalidate";
import {
  setPortalEnabledSchema,
  updateProjectLaunchSchema,
} from "@/lib/validation/portal-settings";

type AdminClient = ReturnType<typeof createAdminClient>;

type ProjectExtra = { projectId: string; workspaceSlug: string };

async function loadProjectExtra(
  admin: AdminClient,
  projectId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: ProjectExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at, workspaces(slug)")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return { ok: false, error: "Project not found." };
  }

  const workspace = data.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Project not found." };
  }

  return {
    ok: true,
    workspaceId: data.workspace_id,
    projectId: data.id,
    visibility: data.visibility === "private" ? "private" : "workspace",
    extra: { projectId: data.id, workspaceSlug },
  };
}

async function revalidatePortalSettings(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/settings/portal`, "page");
    revalidatePortalProject(workspaceSlug, projectId);
  } catch (revalidateError) {
    logger.error("portal-settings: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

// ---------------------------------------------------------------------
// setPortalEnabled
// ---------------------------------------------------------------------

export type SetPortalEnabledResult = ActionResult<{ projectId: string; portalEnabled: boolean; portalEnabledAt: string | null }>;

const setPortalEnabledImpl = withAuthz(
  setPortalEnabledSchema,
  {
    requireWrite: true,
    writeCheck: canManagePortalSettings,
    membershipError: "You don't have permission to manage this project's client portal.",
    writeError: "Only a workspace owner or admin can turn the client portal on or off.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's client portal.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<SetPortalEnabledResult> => {
    const portalEnabledAt = input.enabled ? new Date().toISOString() : null;

    // Through `ctx.supabase` (request-scoped, RLS-active), not
    // `ctx.admin` — see this file's header comment. This is also the
    // exact enforcement point of the DB-level owner/admin-only guard, so
    // a caller who bypassed `writeCheck` above some other way (a stale
    // client, a future code path) still gets rejected here, not just at
    // the UI.
    const { data: updated, error: updateError } = await ctx.supabase
      .from("projects")
      .update({ portal_enabled: input.enabled, portal_enabled_at: portalEnabledAt })
      .eq("id", input.projectId)
      .select("id, portal_enabled, portal_enabled_at")
      .single();

    if (updateError || !updated) {
      logger.error("setPortalEnabled: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong turning the client portal on or off. Please try again.",
      };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: updated.portal_enabled ? "project.portal_enabled" : "project.portal_disabled",
      targetType: "project",
      targetId: input.projectId,
      metadata: { projectId: input.projectId, portalEnabled: updated.portal_enabled },
    });

    // F116 (docs/client-portal-phase-2-plan.md item A): the moment the
    // portal turns ON is this feature's single decision point for when
    // the project's chat channel comes into existence — never on first
    // message, never at project creation (both would mean a channel could
    // exist, empty and unmentioned, for a project whose portal is never
    // turned on). `ensure_project_channel_atomic` is idempotent (a partial
    // unique index on `channels(project_id)` backs it), so toggling the
    // portal off and back on again is a harmless no-op the second time,
    // not a duplicate channel. Never runs on disable — an existing
    // conversation is not deleted just because the portal is hidden,
    // mirroring how disabling the portal doesn't delete shared tasks
    // either (see lib/queries/portal.ts's own header comment on
    // `portal_enabled` being a display gate, not a data-retention one).
    if (updated.portal_enabled) {
      const { error: ensureError } = await ctx.admin.rpc("ensure_project_channel_atomic", {
        p_project_id: input.projectId,
        p_created_by: ctx.user.id,
      });
      if (ensureError) {
        logger.error("setPortalEnabled: failed to ensure project channel", { error: ensureError });
      }
    }

    await revalidatePortalSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: {
        projectId: updated.id,
        portalEnabled: updated.portal_enabled,
        portalEnabledAt: updated.portal_enabled_at,
      },
    };
  },
);

export async function setPortalEnabled(
  projectId: string,
  enabled: boolean,
): Promise<SetPortalEnabledResult> {
  return setPortalEnabledImpl({ projectId, enabled });
}

// ---------------------------------------------------------------------
// updateProjectLaunch — target_launch_date / launch_confidence /
// launch_note / warranty_until / warranty_terms. Any non-viewer,
// non-client role may write these (the `v_writer_cols` tier of the DB
// guard) — same default `canWrite` gate as every other project-detail
// action (deliverables, metrics), not owner/admin-only like
// `setPortalEnabled` above.
// ---------------------------------------------------------------------

export type UpdateProjectLaunchResult = ActionResult<{
        projectId: string;
        targetLaunchDate: string | null;
        launchConfidence: "on_track" | "at_risk" | "slipped" | null;
        launchNote: string | null;
        warrantyUntil: string | null;
        warrantyTerms: string | null;
      }>;

const updateProjectLaunchImpl = withAuthz(
  updateProjectLaunchSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to edit this project's launch details.",
    writeError: "Viewers don't have permission to edit this project's launch details.",
    requireVisibility: true,
    visibilityError: "You don't have permission to edit this project's launch details.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<UpdateProjectLaunchResult> => {
    const { data: updated, error: updateError } = await ctx.supabase
      .from("projects")
      .update({
        target_launch_date: input.targetLaunchDate,
        launch_confidence: input.launchConfidence,
        launch_note: input.launchNote,
        warranty_until: input.warrantyUntil,
        warranty_terms: input.warrantyTerms,
      })
      .eq("id", input.projectId)
      .select(
        "id, target_launch_date, launch_confidence, launch_note, warranty_until, warranty_terms",
      )
      .single();

    if (updateError || !updated) {
      logger.error("updateProjectLaunch: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong saving launch details. Please try again.",
      };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project.launch_updated",
      targetType: "project",
      targetId: input.projectId,
      metadata: { projectId: input.projectId },
    });

    await revalidatePortalSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: {
        projectId: updated.id,
        targetLaunchDate: updated.target_launch_date,
        launchConfidence: updated.launch_confidence as "on_track" | "at_risk" | "slipped" | null,
        launchNote: updated.launch_note,
        warrantyUntil: updated.warranty_until,
        warrantyTerms: updated.warranty_terms,
      },
    };
  },
);

export async function updateProjectLaunch(input: {
  projectId: string;
  targetLaunchDate: string | null;
  launchConfidence: "on_track" | "at_risk" | "slipped" | null;
  launchNote: string | null;
  warrantyUntil: string | null;
  warrantyTerms: string | null;
}): Promise<UpdateProjectLaunchResult> {
  return updateProjectLaunchImpl(input);
}
