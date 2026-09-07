"use server";

// Custom field management: project-scoped field DEFINITIONS
// (`project_custom_fields`) plus per-task VALUES
// (`task_custom_field_values`) — see
// supabase/migrations/20261115010000_project_custom_fields.sql for the
// schema/RLS rationale.
//
// Pattern mirrors lib/actions/page-links.ts: `withAuthz` (lib/actions/
// authz.ts) resolves membership/write/visibility once, `ctx.admin`
// performs the actual write with RLS (this migration's own writer-gated
// policies) as the backstop. Field-definition management (create/delete)
// additionally re-checks `canManageColumns` — the same project-lead-or-
// above predicate `lib/actions/statuses.ts` already uses for board
// columns, the closest existing analogue to "manage this project's field
// structure" — since a plain `canWrite` gate alone would let any member
// reshape a project's custom-field schema, not just its data. Per-task
// value writes use the broader `canEditTask` gate instead, matching every
// other editable field on a task.

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { withAuthz } from "@/lib/actions/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/activity/audit";
import { canManageColumns, canEditTask, type ProjectRole } from "@/lib/auth/permissions";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import {
  createCustomFieldSchema,
  deleteCustomFieldSchema,
  setTaskCustomFieldValueSchema,
} from "@/lib/validation/custom-fields";
import {
  getCustomFieldsForTask,
  type ProjectCustomField,
  type TaskCustomFieldWithValue,
} from "@/lib/queries/custom-fields";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const PERMISSION_DENIED_ERROR =
  "You don't have permission to manage this project's custom fields.";

type AdminClient = ReturnType<typeof createAdminClient>;

type ProjectExtra = { projectId: string; workspaceSlug: string };

// projectRole is deliberately NOT resolved here: `resolveWorkspace` runs
// (via withAuthz, lib/actions/authz.ts) BEFORE the caller's identity is
// known — concurrently with `getUser()`, per that file's own AS-081
// comment — so a project-role lookup here would have no real user id to
// filter on. `canManageColumns`'s project-role check is instead
// re-resolved inside each handler below, against `ctx.user.id`, the real
// verified caller.
async function loadProjectExtra(
  admin: AdminClient,
  projectId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string; visibility: ProjectVisibility; extra: ProjectExtra }
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

type FieldExtra = ProjectExtra & { fieldId: string; fieldName: string };

async function loadFieldExtra(
  admin: AdminClient,
  fieldId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string; visibility: ProjectVisibility; extra: FieldExtra }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_custom_fields")
    .select("id, project_id, name")
    .eq("id", fieldId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Field not found." };
  }

  const project = await loadProjectExtra(admin, data.project_id);
  if (!project.ok) return project;

  return {
    ...project,
    extra: { ...project.extra, fieldId: data.id, fieldName: data.name },
  };
}

// Re-resolves the caller's real project role, using the verified user id
// from `ctx` — see loadProjectExtra's comment for why this can't happen
// inside resolveWorkspace itself.
async function resolveProjectRole(
  admin: AdminClient,
  projectId: string,
  userId: string,
): Promise<ProjectRole> {
  const { data } = await admin
    .from("project_members")
    .select("project_role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.project_role as ProjectRole) ?? null;
}

type TaskExtra = { projectId: string; workspaceSlug: string; taskId: string };

async function loadTaskExtra(
  admin: AdminClient,
  taskId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string; visibility: ProjectVisibility; extra: TaskExtra }
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
    return { ok: false, error: "Task not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Task not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Task not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, taskId: data.id },
  };
}

async function revalidateProjectSettings(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/settings/custom-fields`, "page");
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}`, "layout");
  } catch (revalidateError) {
    logger.error("custom-fields: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

export type CustomFieldActionResult =
  | { ok: true; data: ProjectCustomField }
  | { ok: false; error: string };

// AS: an admin/owner (or project lead) can define a custom field on a
// project.
const createCustomFieldImpl = withAuthz(
  createCustomFieldSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    membershipError: PERMISSION_DENIED_ERROR,
    writeError: PERMISSION_DENIED_ERROR,
    visibilityError: PERMISSION_DENIED_ERROR,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<CustomFieldActionResult> => {
    // withAuthz's own `canWrite` gate already ran; this feature's own,
    // narrower gate (field-definition management is closer to "manage
    // this project's structure" than a plain write) is re-checked here
    // against the real, verified caller.
    const projectRole = await resolveProjectRole(ctx.admin, ctx.projectId, ctx.user.id);
    if (!canManageColumns({ role: ctx.role, projectRole })) {
      return { ok: false, error: PERMISSION_DENIED_ERROR };
    }

    const { data: last } = await ctx.admin
      .from("project_custom_fields")
      .select("position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = ((last as { position: number } | null)?.position ?? 0) + 1000;

    const { data: inserted, error } = await ctx.admin
      .from("project_custom_fields")
      .insert({
        project_id: ctx.projectId,
        name: input.name,
        field_type: input.fieldType,
        position: newPosition,
      })
      .select("id, project_id, name, field_type, position")
      .single();

    if (error || !inserted) {
      if (error?.code === "23505") {
        return { ok: false, error: "A field with this name already exists." };
      }
      logger.error("createCustomField: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_custom_field.created",
      targetType: "project_custom_field",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, name: inserted.name },
    });

    await revalidateProjectSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: {
        id: inserted.id,
        projectId: inserted.project_id,
        name: inserted.name,
        fieldType: inserted.field_type as ProjectCustomField["fieldType"],
        position: inserted.position,
      },
    };
  },
);

export async function createCustomField(input: {
  projectId: string;
  name: string;
  fieldType: "text" | "number" | "url" | "checkbox";
}): Promise<CustomFieldActionResult> {
  return createCustomFieldImpl(input);
}

export type DeleteCustomFieldResult = { ok: true; data: { id: string } } | { ok: false; error: string };

const deleteCustomFieldImpl = withAuthz(
  deleteCustomFieldSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    membershipError: PERMISSION_DENIED_ERROR,
    writeError: PERMISSION_DENIED_ERROR,
    visibilityError: PERMISSION_DENIED_ERROR,
    resolveWorkspace: (input, admin) => loadFieldExtra(admin, input.fieldId),
  },
  async (input, ctx): Promise<DeleteCustomFieldResult> => {
    const projectRole = await resolveProjectRole(ctx.admin, ctx.projectId, ctx.user.id);
    if (!canManageColumns({ role: ctx.role, projectRole })) {
      return { ok: false, error: PERMISSION_DENIED_ERROR };
    }

    const { error } = await ctx.admin
      .from("project_custom_fields")
      .delete()
      .eq("id", ctx.fieldId);

    if (error) {
      logger.error("deleteCustomField: delete failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_custom_field.deleted",
      targetType: "project_custom_field",
      targetId: ctx.fieldId,
      metadata: { projectId: ctx.projectId, name: ctx.fieldName },
    });

    await revalidateProjectSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: { id: ctx.fieldId } };
  },
);

export async function deleteCustomField(fieldId: string): Promise<DeleteCustomFieldResult> {
  return deleteCustomFieldImpl({ fieldId });
}

export type SetTaskCustomFieldValueResult =
  | { ok: true; data: { fieldId: string; value: string | null } }
  | { ok: false; error: string };

// A task's own value for one of its project's custom fields. Uses
// `canEditTask` (broader than field-definition management) — same gate
// every other editable task field goes through.
const setTaskCustomFieldValueImpl = withAuthz(
  setTaskCustomFieldValueSchema,
  {
    requireWrite: true,
    writeCheck: canEditTask,
    requireVisibility: true,
    membershipError: "You don't have permission to edit this task.",
    writeError: "You don't have permission to edit this task.",
    visibilityError: "You don't have permission to edit this task.",
    resolveWorkspace: (input, admin) => loadTaskExtra(admin, input.taskId),
  },
  async (input, ctx): Promise<SetTaskCustomFieldValueResult> => {
    // The field must actually belong to this task's own project — a
    // cross-project fieldId is rejected here (defense in depth; RLS's
    // insert/update policy on task_custom_field_values only checks the
    // TASK side, not that the field belongs to the same project).
    const { data: field } = await ctx.admin
      .from("project_custom_fields")
      .select("id, project_id")
      .eq("id", input.fieldId)
      .maybeSingle();

    if (!field || field.project_id !== ctx.projectId) {
      return { ok: false, error: "This field does not belong to this task's project." };
    }

    const normalizedValue = input.value === null || input.value.trim() === "" ? null : input.value;

    if (normalizedValue === null) {
      const { error } = await ctx.admin
        .from("task_custom_field_values")
        .delete()
        .eq("task_id", input.taskId)
        .eq("field_id", input.fieldId);

      if (error) {
        logger.error("setTaskCustomFieldValue: delete failed", { error });
        return { ok: false, error: GENERIC_ERROR };
      }

      return { ok: true, data: { fieldId: input.fieldId, value: null } };
    }

    const { error } = await ctx.admin
      .from("task_custom_field_values")
      .upsert(
        { task_id: input.taskId, field_id: input.fieldId, value: normalizedValue },
        { onConflict: "task_id,field_id" },
      );

    if (error) {
      logger.error("setTaskCustomFieldValue: upsert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    return { ok: true, data: { fieldId: input.fieldId, value: normalizedValue } };
  },
);

export async function setTaskCustomFieldValue(input: {
  taskId: string;
  fieldId: string;
  fieldType: "text" | "number" | "url" | "checkbox";
  value: string | null;
}): Promise<SetTaskCustomFieldValueResult> {
  return setTaskCustomFieldValueImpl(input);
}

// Team-side read for the task detail sheet's own editor — not a Server
// Action mutation, but exported alongside these for the client component
// that needs it to call in one place, same "action-shaped read" precedent
// lib/actions/page-links.ts's getPageLinksForTaskAction establishes.
export async function getCustomFieldsForTaskAction(
  taskId: string,
): Promise<{ ok: true; data: TaskCustomFieldWithValue[] } | { ok: false; error: string }> {
  return getCustomFieldsForTask(taskId);
}
