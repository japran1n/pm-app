"use server";

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

import { createClient } from "@/lib/supabase/server";
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
} from "@/lib/validation/statuses";

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
};

async function loadColumnContext(
  admin: ReturnType<typeof createAdminClient>,
  columnId: string,
): Promise<ColumnContext | null> {
  const { data, error } = await admin
    .from("project_statuses")
    .select("id, project_id, name, color, category, position")
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
    console.error("statuses: revalidatePath failed (non-fatal):", revalidateError);
  }
}

export type ColumnActionResult =
  | {
      ok: true;
      data: { id: string; name: string; color: string; category: string; position: number };
    }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    console.error("addColumn: insert failed:", insertError);
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
}): Promise<ColumnActionResult> {
  const parsed = updateColumnSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid column." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const { data: updated, error: updateError } = await supabase
    .from("project_statuses")
    .update({
      name: parsed.data.name,
      color: parsed.data.color,
      category: parsed.data.category,
    })
    .eq("id", column.id)
    .select("id, name, color, category, position")
    .single();

  if (updateError || !updated) {
    if (updateError?.code === "23505") {
      return { ok: false, error: "A column with this name already exists." };
    }
    console.error("updateColumn: update failed:", updateError);
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
      },
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("project_statuses")
    .update({ position: parsed.data.position })
    .eq("id", column.id)
    .select("id, name, color, category, position")
    .single();

  if (updateError || !updated) {
    console.error("reorderColumn: update failed:", updateError);
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
    },
  };
}

export type RemoveColumnResult = { ok: true; data: { id: string } } | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    console.error("removeColumn: delete failed:", deleteError);
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
