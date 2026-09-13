"use server";
import { logger } from "@/lib/observability/logger";


// F228: saved-view Server Actions (AS-428, AS-430, AS-431). Schema/RLS
// laid down by F227 (supabase/migrations/20260826010000_create_saved_views.sql)
// already enforces the "owner only" floor for UPDATE/DELETE and full
// visibility on SELECT/INSERT -- this file's job is the layer on top:
// - AS-430's "creator OR ADMIN" exception for SHARED views, which RLS
//   deliberately does not grant (F227's own header comment says so) --
//   handled here via `createAdminClient()` + `canManageSavedView`
//   (lib/auth/permissions.ts), re-checked server-side exactly like
//   `canManageColumns` in lib/actions/statuses.ts.
// - AS-431's "exactly one default per (owner, project)" atomicity, via
//   the `set_saved_view_default` RPC
//   (supabase/migrations/20260827010000_saved_views_set_default_rpc.sql),
//   same idiom as `reassign_and_delete_project_status`.
// - Closing the gap the orchestrator found in F227: `saved_views` has
//   both `workspace_id` and a nullable `project_id`, and nothing in the
//   RLS constrains the pair to actually match. `createSavedView` below
//   resolves the project's REAL workspace_id server-side (via the admin
//   client, bypassing the caller's own visibility) and REJECTS the write
//   if the caller-supplied `workspaceId` disagrees, rather than silently
//   trusting or silently overwriting it -- an explicit, testable failure
//   is safer than either alternative for an integrity gap like this.

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { canManageSavedView } from "@/lib/auth/permissions";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import {
  createSavedViewSchema,
  updateSavedViewSchema,
  type SavedViewScope,
  type SavedViewType,
  type SavedViewConfig,
} from "@/lib/validation/views";
import type { ActionResult } from "@/lib/actions/authz";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const NOT_FOUND_ERROR = "View not found.";
const PERMISSION_DENIED_ERROR = "You don't have permission to manage this view.";
const WORKSPACE_MISMATCH_ERROR =
  "This view's workspace does not match the project it belongs to.";

export type SavedViewRecord = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  ownerId: string;
  name: string;
  scope: SavedViewScope;
  viewType: SavedViewType;
  config: SavedViewConfig;
  isDefault: boolean;
};

export type SavedViewActionResult = ActionResult<SavedViewRecord>;

function toRecord(row: {
  id: string;
  workspace_id: string;
  project_id: string | null;
  owner_id: string;
  name: string;
  scope: string;
  view_type: string;
  config: unknown;
  is_default: boolean;
}): SavedViewRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    name: row.name,
    scope: row.scope as SavedViewScope,
    viewType: row.view_type as SavedViewType,
    config: row.config as SavedViewConfig,
    isDefault: row.is_default,
  };
}

type LoadedProject = { id: string; workspaceId: string; visibility: "workspace" | "private" };

async function loadProjectForView(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<LoadedProject | null> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return null;
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    visibility: data.visibility === "private" ? "private" : "workspace",
  };
}

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

// Re-verifies membership/visibility and, for non-owner callers, the
// AS-430 "admin only" exception. Returns the caller's resolved
// { userId, isOwner, useAdminClient } so the calling action knows which
// client is allowed to perform the write, or null when denied.
async function authorizeViewMutation(
  admin: ReturnType<typeof createAdminClient>,
  view: LoadedView,
  userId: string,
): Promise<{ isOwner: boolean } | null> {
  const membership = await requireActiveMembership(admin, view.workspaceId, userId);
  if (!membership.ok) {
    return null;
  }

  if (view.projectId) {
    const project = await loadProjectForView(admin, view.projectId);
    if (!project) {
      return null;
    }
    const visible = await isProjectVisibleToCaller(
      admin,
      { projectId: project.id, visibility: project.visibility },
      userId,
      membership.role,
    );
    if (!visible) {
      return null;
    }
  }

  const isOwner = view.ownerId === userId;
  if (isOwner) {
    return { isOwner: true };
  }

  // Only a SHARED view can ever be managed by a non-owner (AS-430); a
  // personal view's RLS floor (owner-only) has no admin exception, and
  // this app-layer check must not create one.
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
    // Mirrors checklist.ts/attachments.ts/comments.ts's own convention:
    // resolve the real workspace slug and revalidate its whole `layout`
    // subtree (cheaper than enumerating every view-consuming route, and
    // this repo's established pattern for a mutation whose exact
    // downstream pages aren't worth tracking individually).
    const { data: workspaceRow } = await admin
      .from("workspaces")
      .select("slug")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspaceRow?.slug) {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    }
  } catch (revalidateError) {
    logger.error("views: revalidatePath failed (non-fatal)", { error: revalidateError });
  }
}

// AS-426/AS-427/AS-431: create a personal or shared saved view.
export async function createSavedView(input: {
  workspaceId: string;
  projectId: string | null;
  name: string;
  scope?: SavedViewScope;
  viewType?: SavedViewType;
  config?: SavedViewConfig;
  isDefault?: boolean;
  position?: number;
}): Promise<SavedViewActionResult> {
  const parsed = createSavedViewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid view." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to save a view." };
  }

  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, parsed.data.workspaceId, user.id);
  if (!membership.ok) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  if (parsed.data.projectId) {
    const project = await loadProjectForView(admin, parsed.data.projectId);
    if (!project) {
      return { ok: false, error: "Project not found." };
    }

    // Close the F227 integrity gap: never trust a caller-supplied
    // workspaceId alongside a projectId. Resolve the project's REAL
    // workspace_id server-side and reject outright on any mismatch
    // (rather than silently deriving it) so a forged pair fails loudly
    // and the row is never written under a mismatched workspace.
    if (project.workspaceId !== parsed.data.workspaceId) {
      return { ok: false, error: WORKSPACE_MISMATCH_ERROR };
    }

    const visible = await isProjectVisibleToCaller(
      admin,
      { projectId: project.id, visibility: project.visibility },
      user.id,
      membership.role,
    );
    if (!visible) {
      return { ok: false, error: PERMISSION_DENIED_ERROR };
    }
  }

  // The session-scoped client performs the actual write: `saved_views`'
  // INSERT RLS policy (F227) already enforces `owner_id = auth.uid()` and
  // the same visibility rule re-checked above, so this is the real,
  // exercised enforcement boundary -- the checks above exist to turn a
  // bare RLS rejection into a specific, friendly message, and to catch
  // the workspace/project mismatch RLS does not check at all.
  const { data: inserted, error: insertError } = await supabase
    .from("saved_views")
    .insert({
      workspace_id: parsed.data.workspaceId,
      project_id: parsed.data.projectId,
      owner_id: user.id,
      name: parsed.data.name,
      scope: parsed.data.scope,
      view_type: parsed.data.viewType,
      config: parsed.data.config,
      is_default: false,
      ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
    })
    .select("id, workspace_id, project_id, owner_id, name, scope, view_type, config, is_default")
    .single();

  if (insertError || !inserted) {
    logger.error("createSavedView: insert failed", { error: insertError });
    return { ok: false, error: GENERIC_ERROR };
  }

  let record = toRecord(inserted);

  // isDefault requested at creation time: route through the same atomic
  // RPC as setDefaultSavedView so a brand-new view can be created AND
  // made the default in one call without ever risking two defaults.
  if (parsed.data.isDefault) {
    const { error: rpcError } = await admin.rpc("set_saved_view_default", {
      p_view_id: inserted.id,
    });
    if (rpcError) {
      logger.error("createSavedView: set_saved_view_default failed", { error: rpcError });
    } else {
      record = { ...record, isDefault: true };
    }
  }

  await revalidateViewRoutes(admin, parsed.data.workspaceId);

  return { ok: true, data: record };
}

// AS-426/AS-427/AS-430: rename/update a view's config. isDefault (AS-431)
// is handled via the atomic RPC when true; when false it is a plain field
// update (unsetting a default can never collide with the unique index).
export async function updateSavedView(input: {
  viewId: string;
  name?: string;
  scope?: SavedViewScope;
  viewType?: SavedViewType;
  config?: SavedViewConfig;
  isDefault?: boolean;
  position?: number;
}): Promise<SavedViewActionResult> {
  const parsed = updateSavedViewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid view." };
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

  const authz = await authorizeViewMutation(admin, view, user.id);
  if (!authz) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  // "The user's default" is scoped per owner_id (F227's unique index) --
  // only the view's own owner can meaningfully set it as THEIR default,
  // even when an admin is otherwise allowed to edit a shared view's other
  // fields.
  if (parsed.data.isDefault === true && !authz.isOwner) {
    return {
      ok: false,
      error: "Only this view's owner can set it as their default.",
    };
  }

  const patch: {
    name?: string;
    scope?: string;
    view_type?: string;
    config?: Json;
    is_default?: boolean;
    position?: number;
  } = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.scope !== undefined) patch.scope = parsed.data.scope;
  if (parsed.data.viewType !== undefined) patch.view_type = parsed.data.viewType;
  if (parsed.data.config !== undefined) patch.config = parsed.data.config as unknown as Json;
  if (parsed.data.isDefault === false) patch.is_default = false;
  if (parsed.data.position !== undefined) patch.position = parsed.data.position;

  // No-op input (Clarified implementation #6): nothing to write and no
  // default change requested -- return the current row without an error
  // toast, matching this repo's "intentional no-op" convention.
  if (Object.keys(patch).length === 0 && parsed.data.isDefault !== true) {
    const { data: current, error: readError } = await admin
      .from("saved_views")
      .select("id, workspace_id, project_id, owner_id, name, scope, view_type, config, is_default")
      .eq("id", view.id)
      .maybeSingle();
    if (readError || !current) {
      return { ok: false, error: NOT_FOUND_ERROR };
    }
    return { ok: true, data: toRecord(current) };
  }

  // The owner writes through the session-scoped, RLS-respecting client
  // (owner-only UPDATE policy already covers this exactly); a non-owner
  // admin managing a SHARED view must go through the admin client, since
  // RLS's UPDATE policy has no admin exception by design (F227's own
  // documented convention -- see the migration's UPDATE policy comment).
  const client = authz.isOwner ? supabase : admin;

  let updatedRow:
    | {
        id: string;
        workspace_id: string;
        project_id: string | null;
        owner_id: string;
        name: string;
        scope: string;
        view_type: string;
        config: unknown;
        is_default: boolean;
      }
    | null = null;

  if (Object.keys(patch).length > 0) {
    const { data: updated, error: updateError } = await client
      .from("saved_views")
      .update(patch)
      .eq("id", view.id)
      .select("id, workspace_id, project_id, owner_id, name, scope, view_type, config, is_default")
      .single();

    if (updateError || !updated) {
      logger.error("updateSavedView: update failed", { error: updateError });
      return { ok: false, error: GENERIC_ERROR };
    }
    updatedRow = updated;
  }

  if (parsed.data.isDefault === true) {
    const { error: rpcError } = await admin.rpc("set_saved_view_default", {
      p_view_id: view.id,
    });
    if (rpcError) {
      logger.error("updateSavedView: set_saved_view_default failed", { error: rpcError });
      return { ok: false, error: GENERIC_ERROR };
    }
  }

  const { data: finalRow, error: finalReadError } = await admin
    .from("saved_views")
    .select("id, workspace_id, project_id, owner_id, name, scope, view_type, config, is_default")
    .eq("id", view.id)
    .maybeSingle();

  if (finalReadError || !finalRow) {
    if (updatedRow) {
      return { ok: true, data: toRecord(updatedRow) };
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateViewRoutes(admin, view.workspaceId);

  return { ok: true, data: toRecord(finalRow) };
}

export type DeleteSavedViewResult = ActionResult<{ id: string }>;

// AS-430: only the creator, or a workspace admin/owner (for a shared
// view), can delete a view.
export async function deleteSavedView(viewId: string): Promise<DeleteSavedViewResult> {
  if (typeof viewId !== "string" || viewId.length === 0) {
    return { ok: false, error: "Invalid view." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage views." };
  }

  const admin = createAdminClient();
  const view = await loadViewForAuthz(admin, viewId);
  if (!view) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const authz = await authorizeViewMutation(admin, view, user.id);
  if (!authz) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  const client = authz.isOwner ? supabase : admin;
  const { error: deleteError } = await client.from("saved_views").delete().eq("id", view.id);

  if (deleteError) {
    logger.error("deleteSavedView: delete failed", { error: deleteError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateViewRoutes(admin, view.workspaceId);

  return { ok: true, data: { id: view.id } };
}

// AS-431: set a view as the caller's default for its project. Only the
// view's own owner may do this (is_default is scoped per owner_id, not
// per viewer -- see F227's unique index and this file's header comment),
// even for a shared view an admin can otherwise edit/delete.
export async function setDefaultSavedView(viewId: string): Promise<SavedViewActionResult> {
  if (typeof viewId !== "string" || viewId.length === 0) {
    return { ok: false, error: "Invalid view." };
  }

  const { user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage views." };
  }

  const admin = createAdminClient();
  const view = await loadViewForAuthz(admin, viewId);
  if (!view) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  if (view.ownerId !== user.id) {
    return { ok: false, error: "Only this view's owner can set it as their default." };
  }

  const membership = await requireActiveMembership(admin, view.workspaceId, user.id);
  if (!membership.ok) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  const { error: rpcError } = await admin.rpc("set_saved_view_default", {
    p_view_id: view.id,
  });
  if (rpcError) {
    logger.error("setDefaultSavedView: rpc failed", { error: rpcError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const { data: updated, error: readError } = await admin
    .from("saved_views")
    .select("id, workspace_id, project_id, owner_id, name, scope, view_type, config, is_default")
    .eq("id", view.id)
    .maybeSingle();

  if (readError || !updated) {
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateViewRoutes(admin, view.workspaceId);

  return { ok: true, data: toRecord(updated) };
}

export type GetSavedViewResult = ActionResult<SavedViewRecord>;

// AS-428: read a view (through the caller's own RLS-scoped session --
// `saved_views`' SELECT policy is the real visibility boundary here, no
// admin client involved) so its config can be handed to
// lib/views/apply-view.ts's buildViewSearchParams to restore filters,
// sort, and grouping exactly.
export async function getSavedView(viewId: string): Promise<GetSavedViewResult> {
  if (typeof viewId !== "string" || viewId.length === 0) {
    return { ok: false, error: "Invalid view." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to open a view." };
  }

  const { data, error } = await supabase
    .from("saved_views")
    .select("id, workspace_id, project_id, owner_id, name, scope, view_type, config, is_default")
    .eq("id", viewId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  return { ok: true, data: toRecord(data) };
}
