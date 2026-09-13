"use server";
import { logger } from "@/lib/observability/logger";


// F219: board column ("project status") management actions (AS-404,
// AS-405, AS-414, AS-415).
//
// Pattern mirrors lib/actions/checklist.ts: the request-scoped,
// RLS-respecting client (`supabase`, from lib/supabase/server.ts) performs
// every actual write, since `project_statuses` already has real select/
// insert/update/delete RLS
// (supabase/migrations/20260824010000_project_statuses.sql, reusing
// `public.is_project_visible_to`) — RLS is the real, exercised enforcement
// boundary for visibility. `createAdminClient()` is used ONLY for
// read-only lookups that need to resolve real data (a column's true
// owning project/workspace) regardless of the caller's own RLS
// visibility, same convention checklist.ts documents.
//
// AS-414 is enforced here, not by RLS: `project_statuses`' RLS only knows
// about project VISIBILITY (can this caller see the project at all), not
// the finer-grained "is this caller allowed to manage columns" rule
// (owner/admin, or project lead) — that rule lives in
// `canManageColumns` (lib/auth/permissions.ts, F127's single-source
// convention) and is re-checked in every action below before any write,
// exactly as the Clarified implementation's Access control answer
// requires ("the server still rejects the call").
//
// AS-415 is enforced twice, per this repo's "the DB is the last line, not
// the only line" convention: `removeColumn` below checks the column count
// itself first (so the caller gets a friendly message), and
// supabase/migrations/20260824020000_project_statuses_management.sql's
// `project_statuses_prevent_last_delete` trigger is the real, unbypassable
// backstop.

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageColumns, type WorkspaceRole, type ProjectRole } from "@/lib/auth/permissions";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import { writeAudit } from "@/lib/activity/audit";
import {
  addColumnSchema,
  updateColumnSchema,
  reorderColumnSchema,
  removeColumnSchema,
  removeColumnWithReassignmentSchema,
} from "@/lib/validation/statuses";
import type { ActionResult } from "@/lib/actions/authz";

const PERMISSION_DENIED_ERROR =
  "You don't have permission to manage this project's board columns.";
const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

type ProjectContext = {
  id: string;
  workspaceId: string;
  workspaceSlug: string;
  visibility: "workspace" | "private";
};

async function loadProjectContext(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<ProjectContext | null> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at, workspaces(slug)")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return null;
  }

  const workspace = data.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;

  if (!workspaceSlug) {
    return null;
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    workspaceSlug,
    visibility: data.visibility === "private" ? "private" : "workspace",
  };
}

type ColumnContext = {
  id: string;
  projectId: string;
  name: string;
  color: string;
  category: string;
  position: number;
  // F004: the client-facing explanation (AS-016) and bucket override
  // (AS-015) — carried through every action's context load so a write
  // that doesn't touch these two fields (e.g. `reorderColumn`) can still
  // return them unchanged rather than dropping them from its response.
  clientDescription: string | null;
  clientBucket: string | null;
};

async function loadColumnContext(
  admin: ReturnType<typeof createAdminClient>,
  columnId: string,
): Promise<ColumnContext | null> {
  const { data, error } = await admin
    .from("project_statuses")
    .select("id, project_id, name, color, category, position, client_description, client_bucket")
    .eq("id", columnId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    projectId: data.project_id,
    name: data.name,
    color: data.color,
    category: data.category,
    position: data.position,
    clientDescription: data.client_description,
    clientBucket: data.client_bucket,
  };
}

// Resolves the caller's workspace role + project role, and independently
// re-checks project visibility (AS-227/AS-228 convention,
// lib/actions/project-visibility.ts) and column-management permission
// (AS-414). Returns null (with the caller-facing error already decided by
// the calling action) when any check fails.
async function authorizeColumnManagement(
  admin: ReturnType<typeof createAdminClient>,
  project: ProjectContext,
  userId: string,
): Promise<{ role: WorkspaceRole; projectRole: ProjectRole } | null> {
  const membership = await requireActiveMembership(admin, project.workspaceId, userId);
  if (!membership.ok) {
    return null;
  }

  const { data: projectMemberRow } = await admin
    .from("project_members")
    .select("project_role")
    .eq("project_id", project.id)
    .eq("user_id", userId)
    .maybeSingle();

  const projectRole = (projectMemberRow?.project_role ?? null) as ProjectRole;

  const visible = await isProjectVisibleToCaller(
    admin,
    { projectId: project.id, visibility: project.visibility },
    userId,
    membership.role,
  );
  if (!visible) {
    return null;
  }

  if (!canManageColumns({ role: membership.role, projectRole })) {
    return null;
  }

  return { role: membership.role, projectRole };
}

async function revalidateProjectSettings(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(
      `/w/${workspaceSlug}/projects/${projectId}/settings/columns`,
      "page",
    );
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/board`, "page");
  } catch (revalidateError) {
    // Non-fatal: revalidatePath throws outside an active request/render
    // context (e.g. invoked from a test harness) — the write already
    // succeeded. Same convention as every other lib/actions/*.ts file.
    logger.error("statuses: revalidatePath failed (non-fatal)", { error: revalidateError });
  }
}

export type ColumnActionResult = ActionResult<{
        id: string;
        name: string;
        color: string;
        category: string;
        position: number;
        clientDescription: string | null;
        clientBucket: string | null;
      }>;

// AS-404: an admin (or project lead) can add a board column.
export async function addColumn(input: {
  projectId: string;
  name: string;
  color: string;
  category: string;
}): Promise<ColumnActionResult> {
  const parsed = addColumnSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid column." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage board columns." };
  }

  const admin = createAdminClient();
  const project = await loadProjectContext(admin, parsed.data.projectId);
  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  const authorized = await authorizeColumnManagement(admin, project, user.id);
  if (!authorized) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  const { data: lastColumn } = await admin
    .from("project_statuses")
    .select("position")
    .eq("project_id", project.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newPosition = (lastColumn?.position ?? 0) + 1000;

  const { data: inserted, error: insertError } = await supabase
    .from("project_statuses")
    .insert({
      project_id: project.id,
      name: parsed.data.name,
      color: parsed.data.color,
      category: parsed.data.category,
      position: newPosition,
    })
    .select("id, name, color, category, position")
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return { ok: false, error: "A column with this name already exists." };
    }
    logger.error("addColumn: insert failed", { error: insertError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await writeAudit(supabase, {
    workspaceId: project.workspaceId,
    action: "project_status.created",
    targetType: "project_status",
    targetId: inserted.id,
    metadata: { projectId: project.id, name: inserted.name },
  });

  await revalidateProjectSettings(project.workspaceSlug, project.id);

  return {
    ok: true,
    data: {
      id: inserted.id,
      name: inserted.name,
      color: inserted.color,
      category: inserted.category,
      position: inserted.position,
      // F004: a newly created column always starts with no client
      // description and no bucket override (both DB-default null) — set
      // explicitly here rather than re-selecting them, since there is
      // nothing else they could be immediately after insert.
      clientDescription: null,
      clientBucket: null,
    },
  };
}

// AS-404/AS-405: an admin (or project lead) can rename a column and
// change its colour/category. A single action rather than three separate
// ones — this repo's "simpler option, no second source of truth"
// resolution for this feature's open Notes question — since all three
// fields are edited from the same inline row in the UI and always
// re-submitted together.
export async function updateColumn(input: {
  columnId: string;
  name: string;
  color: string;
  category: string;
  // F004: optional — see updateColumnSchema's comment. Every pre-F004
  // caller keeps working unchanged by simply not passing these two.
  clientDescription?: string;
  clientBucket?: string;
}): Promise<ColumnActionResult> {
  const parsed = updateColumnSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid column." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage board columns." };
  }

  const admin = createAdminClient();
  const column = await loadColumnContext(admin, parsed.data.columnId);
  if (!column) {
    return { ok: false, error: "Column not found." };
  }

  const project = await loadProjectContext(admin, column.projectId);
  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  const authorized = await authorizeColumnManagement(admin, project, user.id);
  if (!authorized) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  // F004 (AS-015, AS-016): `clientDescriptionSchema`/`clientBucketSchema`
  // already normalised "" -> null and "auto" -> null, so writing the
  // parsed value directly is not a second place that re-derives the
  // fallback — `resolveClientBucket` (components/portal/status-label.ts)
  // is the only place a null `client_bucket` gets turned into an actual
  // bucket, and only at read time. A field left `undefined` (an
  // pre-F004 caller that never sends it) is omitted from the update
  // entirely, leaving the column's current value untouched, rather than
  // being coerced to null and silently clearing it.
  const updatePayload: {
    name: string;
    color: string;
    category: string;
    client_description?: string | null;
    client_bucket?: string | null;
  } = {
    name: parsed.data.name,
    color: parsed.data.color,
    category: parsed.data.category,
  };
  if (parsed.data.clientDescription !== undefined) {
    updatePayload.client_description = parsed.data.clientDescription;
  }
  if (parsed.data.clientBucket !== undefined) {
    updatePayload.client_bucket = parsed.data.clientBucket;
  }

  const { data: updated, error: updateError } = await supabase
    .from("project_statuses")
    .update(updatePayload)
    .eq("id", column.id)
    .select("id, name, color, category, position, client_description, client_bucket")
    .single();

  if (updateError || !updated) {
    if (updateError?.code === "23505") {
      return { ok: false, error: "A column with this name already exists." };
    }
    if (updateError?.code === "23514") {
      // project_statuses_client_bucket_check
      // (20260911010000_status_client_bucket.sql) — the Zod schema
      // already rejects an invalid bucket, so this is a defence-in-depth
      // backstop, not the primary path a real caller hits.
      return { ok: false, error: "Choose a valid client status bucket." };
    }
    logger.error("updateColumn: update failed", { error: updateError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await writeAudit(supabase, {
    workspaceId: project.workspaceId,
    action: "project_status.updated",
    targetType: "project_status",
    targetId: updated.id,
    metadata: {
      projectId: project.id,
      previousName: column.name,
      name: updated.name,
    },
  });

  await revalidateProjectSettings(project.workspaceSlug, project.id);

  return {
    ok: true,
    data: {
      id: updated.id,
      name: updated.name,
      color: updated.color,
      category: updated.category,
      position: updated.position,
      clientDescription: updated.client_description,
      clientBucket: updated.client_bucket,
    },
  };
}

// AS-404: an admin (or project lead) can reorder columns. Mirrors
// reorderChecklistItem's division of responsibility — the CALLER computes
// the new fractional-index value (lib/board/position.ts's
// calculatePosition) from the dropped column's new neighbors; this action
// only persists it.
export async function reorderColumn(
  columnId: string,
  newPosition: number,
): Promise<ColumnActionResult> {
  const parsed = reorderColumnSchema.safeParse({ columnId, position: newPosition });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid position." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage board columns." };
  }

  const admin = createAdminClient();
  const column = await loadColumnContext(admin, parsed.data.columnId);
  if (!column) {
    return { ok: false, error: "Column not found." };
  }

  const project = await loadProjectContext(admin, column.projectId);
  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  const authorized = await authorizeColumnManagement(admin, project, user.id);
  if (!authorized) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  if (column.position === parsed.data.position) {
    return {
      ok: true,
      data: {
        id: column.id,
        name: column.name,
        color: column.color,
        category: column.category,
        position: column.position,
        clientDescription: column.clientDescription,
        clientBucket: column.clientBucket,
      },
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("project_statuses")
    .update({ position: parsed.data.position })
    .eq("id", column.id)
    .select("id, name, color, category, position, client_description, client_bucket")
    .single();

  if (updateError || !updated) {
    logger.error("reorderColumn: update failed", { error: updateError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateProjectSettings(project.workspaceSlug, project.id);

  return {
    ok: true,
    data: {
      id: updated.id,
      name: updated.name,
      color: updated.color,
      category: updated.category,
      position: updated.position,
      clientDescription: updated.client_description,
      clientBucket: updated.client_bucket,
    },
  };
}

export type RemoveColumnResult = ActionResult<{ id: string }>;

// AS-404: an admin (or project lead) can remove a column.
// AS-415: a project can never be left with zero columns — checked here
// first (friendly message) and backstopped by the
// `project_statuses_prevent_last_delete` DB trigger.
//
// Removal's task-reassignment flow (AS-406: "removing a column requires
// choosing a destination column for its tasks; no task is orphaned") is
// F220's job, per this feature's spec — out of scope here. Until F220
// lands, this action refuses to remove a column that still has tasks
// assigned to it, so no task can be silently orphaned by F219 alone; the
// caller sees an actionable message rather than data loss.
export async function removeColumn(columnId: string): Promise<RemoveColumnResult> {
  const parsed = removeColumnSchema.safeParse({ columnId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid column." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage board columns." };
  }

  const admin = createAdminClient();
  const column = await loadColumnContext(admin, parsed.data.columnId);
  if (!column) {
    return { ok: false, error: "Column not found." };
  }

  const project = await loadProjectContext(admin, column.projectId);
  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  const authorized = await authorizeColumnManagement(admin, project, user.id);
  if (!authorized) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  const { count: siblingCount } = await admin
    .from("project_statuses")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);

  if ((siblingCount ?? 0) <= 1) {
    return { ok: false, error: "A project must have at least one board column." };
  }

  const { count: taskCount } = await admin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("status_id", column.id)
    .is("deleted_at", null);

  if ((taskCount ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This column still has tasks in it. Move its tasks to another column before removing it.",
    };
  }

  const { error: deleteError } = await supabase
    .from("project_statuses")
    .delete()
    .eq("id", column.id);

  if (deleteError) {
    if (deleteError.message?.includes("at least one board column")) {
      return { ok: false, error: "A project must have at least one board column." };
    }
    logger.error("removeColumn: delete failed", { error: deleteError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await writeAudit(supabase, {
    workspaceId: project.workspaceId,
    action: "project_status.removed",
    targetType: "project_status",
    targetId: column.id,
    metadata: { projectId: project.id, name: column.name },
  });

  await revalidateProjectSettings(project.workspaceSlug, project.id);

  return { ok: true, data: { id: column.id } };
}

// F220 (AS-406): removing a column requires an explicit destination
// column for its tasks; the reassignment and the delete happen
// atomically. This is the real removal path the UI uses now — it
// supersedes the "refuse if non-empty" `removeColumn` above for the
// column-with-tasks case, though `removeColumn` above is left in place
// (unused by the UI going forward) since it is still a correct, narrower
// operation for an already-empty column and existing tests exercise it
// directly.
//
// Authorization is re-checked here in application code exactly like
// every other action in this file (AS-414 via `canManageColumns`,
// visibility via `isProjectVisibleToCaller`) BEFORE the admin client
// calls the SECURITY DEFINER RPC — the RPC itself is granted only to
// `service_role` (supabase/migrations/
// 20260824040000_status_delete_reassign_rpc.sql) and trusts its caller
// the same way `create_project_from_template` does, so this check is the
// only enforcement boundary for this write.
//
// The destination-belongs-to-the-same-project check is ALSO re-verified
// inside the RPC's own transaction (not just here) — a caller-supplied
// destination id from a different project is a cross-project write and
// must be rejected even under a race, so the DB is the last line here
// too, not the only one.
export async function removeColumnWithReassignment(
  columnId: string,
  destinationColumnId: string,
): Promise<RemoveColumnResult> {
  const parsed = removeColumnWithReassignmentSchema.safeParse({
    columnId,
    destinationColumnId,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage board columns." };
  }

  const admin = createAdminClient();
  const column = await loadColumnContext(admin, parsed.data.columnId);
  if (!column) {
    return { ok: false, error: "Column not found." };
  }

  if (parsed.data.destinationColumnId === column.id) {
    return {
      ok: false,
      error: "Choose a different column to move these tasks to.",
    };
  }

  const project = await loadProjectContext(admin, column.projectId);
  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  const authorized = await authorizeColumnManagement(admin, project, user.id);
  if (!authorized) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  // Cross-project destination check, re-verified again inside the RPC's
  // own transaction below — this app-layer check exists only to give the
  // caller a friendly, specific error before hitting the DB.
  const destination = await loadColumnContext(admin, parsed.data.destinationColumnId);
  if (!destination || destination.projectId !== project.id) {
    return {
      ok: false,
      error: "The destination column must belong to the same project.",
    };
  }

  const { count: taskCount } = await admin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("status_id", column.id)
    .is("deleted_at", null);

  const { error: rpcError } = await admin.rpc("reassign_and_delete_project_status", {
    p_source_status_id: column.id,
    p_destination_status_id: destination.id,
  });

  if (rpcError) {
    if (rpcError.message?.includes("at least one board column")) {
      return { ok: false, error: "A project must have at least one board column." };
    }
    logger.error("removeColumnWithReassignment: rpc failed", { error: rpcError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await writeAudit(supabase, {
    workspaceId: project.workspaceId,
    action: "project_status.removed",
    targetType: "project_status",
    targetId: column.id,
    metadata: {
      projectId: project.id,
      name: column.name,
      destinationColumnId: destination.id,
      destinationColumnName: destination.name,
      reassignedTaskCount: taskCount ?? 0,
    },
  });

  await revalidateProjectSettings(project.workspaceSlug, project.id);

  return { ok: true, data: { id: column.id } };
}
