"use server";
import { logger } from "@/lib/observability/logger";


// F182 (AS-330, AS-331, AS-332): task-template create/apply/rename/delete
// Server Actions. Templates (F181's `task_templates` table, `kind='task'`)
// are snapshots, not live links — applying a template pre-fills a new
// task's fields once, at creation time; there is no ongoing relationship
// between a created task and the template it came from (AS-332), and no
// FK from `tasks` back to `task_templates`.
//
// Pattern mirrors every sibling action in lib/actions/tasks.ts: Zod at the
// boundary, requireActiveMembership + lib/auth/permissions.ts predicates
// re-checked server-side (defense in depth — RLS on `task_templates`,
// F181's migration, also enforces workspace scoping and creator-or-admin
// writes), admin client for the actual read/write, discriminated-union
// return, generic user-facing errors with details only logged server-side.

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveProjectStatusName } from "@/lib/tasks/resolve-status";
import {
  saveTaskAsTemplateSchema,
  createTaskFromTemplateSchema,
  renameTemplateSchema,
  deleteTemplateSchema,
  setDefaultTemplateSchema,
  taskTemplatePayloadSchema,
  saveProjectAsTemplateSchema,
  createProjectFromTemplateSchema,
  projectTemplatePayloadSchema,
  type TaskTemplatePayload,
  type ProjectTemplatePayload,
  type ProjectTemplateDeliverable,
} from "@/lib/validation/templates";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canCreateProject, canWrite } from "@/lib/auth/permissions";
import { calculatePosition } from "@/lib/board/position";
import { cloneTaskFields } from "@/lib/recurrence/clone-fields";
import {
  sanitiseMentionsForVisibility,
  stripAllMentions,
} from "@/lib/comments/mentions";
import type { JSONContent } from "@/components/editor/rich-text-editor";
import type { Json } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/lib/actions/authz";

// --- saveTaskAsTemplate -----------------------------------------------------

export type SaveTaskAsTemplateResult = ActionResult<{
        id: string;
        name: string;
        workspaceId: string;
      }>;

// Snapshots a task's clonable fields (the SAME allow-list F176's
// cloneTaskFields/F180's duplicateTask use: title, description,
// description_json, priority, checklistItems, estimate_minutes, tags —
// plus assigneeIds, saved into the payload so createTaskFromTemplate can
// offer to pre-fill assignees) into a new `task_templates` row, scoped to
// the task's own workspace (never a workspace supplied by the client).
export async function saveTaskAsTemplate(
  taskId: string,
  name: string,
): Promise<SaveTaskAsTemplateResult> {
  const parsed = saveTaskAsTemplateSchema.safeParse({ taskId, name });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid template details.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to save a template." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: sourceRow, error: sourceError } = await admin
    .from("tasks")
    .select(
      "id, project_id, title, description, description_json, priority, tags, estimate_minutes, deleted_at, projects(workspace_id)",
    )
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (sourceError || !sourceRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = sourceRow.projects as
    | { workspace_id: string }
    | { workspace_id: string }[]
    | null;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to save a template from this task.",
    };
  }

  // Saving a template is a write (it creates a new row) — gated the same
  // way createTask/duplicateTask gate their own writes (AS-216/AS-217:
  // viewers are read-only).
  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to save templates.",
    };
  }

  const [assigneesResult, checklistResult] = await Promise.all([
    admin
      .from("task_assignees")
      .select("user_id, created_at")
      .eq("task_id", parsed.data.taskId)
      .order("created_at", { ascending: true }),
    admin
      .from("checklist_items")
      .select("content, position")
      .eq("task_id", parsed.data.taskId)
      .order("position", { ascending: true }),
  ]);

  const cloned = cloneTaskFields({
    title: sourceRow.title,
    description: sourceRow.description,
    description_json: sourceRow.description_json,
    assigneeIds: (assigneesResult.data ?? []).map(
      (row) => row.user_id as string,
    ),
    priority: sourceRow.priority,
    checklistItems: (checklistResult.data ?? []).map((row) => ({
      content: row.content as string,
      position: row.position as number,
    })),
    estimate_minutes: sourceRow.estimate_minutes,
  });

  const payload: TaskTemplatePayload = {
    title: cloned.title,
    description: cloned.description,
    description_json: cloned.description_json,
    priority: cloned.priority as TaskTemplatePayload["priority"],
    checklistItems: cloned.checklistItems,
    estimate_minutes: cloned.estimate_minutes,
    tags: sourceRow.tags ?? [],
    assigneeIds: cloned.assigneeIds,
  };

  const { data: inserted, error: insertError } = await admin
    .from("task_templates")
    .insert({
      workspace_id: workspaceId,
      kind: "task",
      name: parsed.data.name,
      payload: payload as unknown as Json,
      created_by: user.id,
    })
    .select("id, name, workspace_id")
    .single();

  if (insertError || !inserted) {
    logger.error("saveTaskAsTemplate: insert failed", { error: insertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("saveTaskAsTemplate: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      name: inserted.name,
      workspaceId: inserted.workspace_id,
    },
  };
}

// --- createTaskFromTemplate -------------------------------------------------

export type CreateTaskFromTemplateResult = ActionResult<{
        id: string;
        projectId: string;
        title: string;
        status: string;
        number: number;
        // The assignee ids actually applied to the new task, after
        // dropping any from the template's saved payload who are no
        // longer members of the target workspace (per this feature's
        // spec: "resolves assignees that are no longer members by
        // dropping them rather than failing").
        assigneeIds: string[];
        droppedAssigneeIds: string[];
      }>;

// Creates a new task pre-filled from a template's saved payload
// (AS-330). The new task gets its own key/number via the SAME atomic
// mechanism every other task-creation path in this codebase relies on
// (F145's `assign_task_key` trigger, which fires on any `tasks` insert
// that doesn't supply `number` — never manually computed here, exactly
// like createTaskForUser/duplicateTask in lib/actions/tasks.ts).
//
// Dropped-assignee handling (explicit spec instruction, easy to miss):
// the template's saved assigneeIds are re-checked against ACTIVE
// membership of the TARGET workspace (the project the task is being
// created into) at apply-time, not at save-time — a template can be
// saved once and reused indefinitely, and membership can change in
// between. Any assignee id that is no longer an active member is
// silently dropped from the created task rather than failing the whole
// creation; the dropped ids are still returned in the result so a caller
// (UI) can optionally surface a non-blocking notice, but a plain create
// failure is never raised for this reason.
export async function createTaskFromTemplate(
  templateId: string,
  projectId: string,
  status?: "todo" | "in_progress" | "in_review" | "done",
): Promise<CreateTaskFromTemplateResult> {
  const parsed = createTaskFromTemplateSchema.safeParse({
    templateId,
    projectId,
    status,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid template details.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to create a task from a template.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at")
    .eq("id", parsed.data.projectId)
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
      error: "You don't have permission to create a task in this project.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to create tasks.",
    };
  }

  const { data: templateRow, error: templateError } = await admin
    .from("task_templates")
    .select("id, workspace_id, kind, payload")
    .eq("id", parsed.data.templateId)
    .maybeSingle();

  if (templateError || !templateRow) {
    return { ok: false, error: "Template not found." };
  }

  if (templateRow.kind !== "task") {
    return { ok: false, error: "This template is not a task template." };
  }

  // A template must be applied within its own workspace — the same
  // workspace-scoping rule every other cross-entity lookup in this
  // codebase enforces server-side rather than trusting a client-supplied
  // projectId to already belong to the right workspace.
  if (templateRow.workspace_id !== projectRow.workspace_id) {
    return { ok: false, error: "Template not found." };
  }

  const payloadParsed = taskTemplatePayloadSchema.safeParse(
    templateRow.payload,
  );

  if (!payloadParsed.success) {
    logger.error("createTaskFromTemplate: stored payload failed schema validation", { error: payloadParsed.error });
    return {
      ok: false,
      error: "This template's saved data is invalid. Please re-save it.",
    };
  }

  const payload = payloadParsed.data;

  // AS-330 setup / dropped-assignee handling: re-verify each saved
  // assignee id is still an active member of the TARGET workspace, and
  // silently drop any that are not, rather than failing the whole
  // create.
  const membershipChecks = await Promise.all(
    payload.assigneeIds.map(async (assigneeId) => ({
      assigneeId,
      membership: await requireActiveMembership(
        admin,
        projectRow.workspace_id,
        assigneeId,
      ),
    })),
  );

  const resolvedAssigneeIds = membershipChecks
    .filter((entry) => entry.membership.ok)
    .map((entry) => entry.assigneeId);
  const droppedAssigneeIds = membershipChecks
    .filter((entry) => !entry.membership.ok)
    .map((entry) => entry.assigneeId);

  // Legacy default "todo" no longer exists post-status_set_v2 — resolve
  // through the shared mapping (lib/tasks/resolve-status.ts).
  const targetStatus = await resolveProjectStatusName(
    admin,
    parsed.data.projectId,
    parsed.data.status ?? "todo",
  );
  if (!targetStatus) {
    return {
      ok: false,
      error: "That column no longer exists. Refresh the board and try again.",
    };
  }

  const { data: lastInColumn } = await admin
    .from("tasks")
    .select("position")
    .eq("project_id", parsed.data.projectId)
    .eq("status", targetStatus)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newTaskPosition = calculatePosition(
    lastInColumn?.position ?? null,
    null,
  );

  // AS-376 (this follow-up feature, F313): a template's description_json
  // may carry mention nodes referencing user ids visible in whatever
  // project the template snapshot was originally taken from. Copying it
  // verbatim into the TARGET project (parsed.data.projectId, which may be
  // a brand-new/private project the mentioned user has no access to) would
  // bypass the exact same enforcement addComment/editComment/editTask
  // already apply to every other write path that persists a mention doc.
  // Re-run the same `sanitiseMentionsForVisibility` check here, against the
  // TARGET project's own context (not the template's origin project),
  // mirroring editTask's descriptionJson handling in lib/actions/tasks.ts.
  // F301: if the underlying visibility lookup itself fails (transient DB
  // error), fail this whole create rather than silently persisting a
  // corrupted ("@Former member") description — same convention as
  // addComment/editComment/editTask.
  let sanitisedDescriptionJson: JSONContent | null =
    payload.description_json as JSONContent | null;
  if (payload.description_json) {
    try {
      sanitisedDescriptionJson = (await sanitiseMentionsForVisibility(
        admin,
        payload.description_json as JSONContent,
        {
          projectId: projectRow.id,
          workspaceId: projectRow.workspace_id,
          projectVisibility: projectRow.visibility ?? "workspace",
        },
      )) as JSONContent;
    } catch (visibilityError) {
      logger.error("createTaskFromTemplate: mention visibility check failed", { error: visibilityError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }
  }

  // F116 (AS-058): a template has no type of its own to carry over, so
  // this resolves (or lazily creates, for a workspace that predates the
  // seed) the target workspace's `delivery` type explicitly — the same
  // value `tasks_default_task_type` would apply automatically, done here
  // so the insert's own required `task_type_id` is satisfied without an
  // extra round trip through that trigger.
  const { data: defaultTaskTypeId, error: taskTypeError } = await admin.rpc(
    "ensure_task_type",
    {
      p_workspace_id: projectRow.workspace_id,
      p_system_key: "delivery",
      p_name: "Delivery",
      p_color: "#6b7280",
      p_is_billable: true,
      p_default_client_visible: false,
    },
  );
  if (taskTypeError || !defaultTaskTypeId) {
    logger.error("createTaskFromTemplate: failed to resolve default task type", { error: taskTypeError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: inserted, error: insertError } = await admin
    .from("tasks")
    .insert({
      project_id: parsed.data.projectId,
      title: payload.title,
      description: payload.description,
      description_json: sanitisedDescriptionJson as Json,
      status: targetStatus,
      priority: payload.priority,
      tags: payload.tags,
      estimate_minutes: payload.estimate_minutes,
      author_id: user.id,
      position: newTaskPosition,
      task_type_id: defaultTaskTypeId,
      // No `number`/key supplied: F145's assign_task_key trigger assigns
      // this new row its own project-sequential number on insert — the
      // template payload never carries a key/number to copy (it isn't in
      // taskTemplatePayloadSchema's shape at all).
    })
    .select("id, project_id, title, status, position, number")
    .single();

  if (insertError || !inserted) {
    logger.error("createTaskFromTemplate: insert failed", { error: insertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (payload.checklistItems.length > 0) {
    const { error: checklistInsertError } = await admin
      .from("checklist_items")
      .insert(
        payload.checklistItems.map((item) => ({
          task_id: inserted.id,
          content: item.content,
          position: item.position,
        })),
      );
    if (checklistInsertError) {
      logger.error("createTaskFromTemplate: checklist insert failed", { error: checklistInsertError });
    }
  }

  if (resolvedAssigneeIds.length > 0) {
    const { error: assigneeInsertError } = await admin
      .from("task_assignees")
      .insert(
        resolvedAssigneeIds.map((assigneeId) => ({
          task_id: inserted.id,
          user_id: assigneeId,
          assigned_by: user.id,
        })),
      );
    if (assigneeInsertError) {
      logger.error("createTaskFromTemplate: assignee insert failed", { error: assigneeInsertError });
    } else {
      await admin
        .from("tasks")
        .update({ assignee_id: resolvedAssigneeIds[0] ?? null })
        .eq("id", inserted.id);
    }
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", projectRow.workspace_id)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("createTaskFromTemplate: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      projectId: inserted.project_id,
      title: inserted.title,
      status: inserted.status,
      number: inserted.number,
      assigneeIds: resolvedAssigneeIds,
      droppedAssigneeIds,
    },
  };
}

// --- renameTemplate ----------------------------------------------------------

export type RenameTemplateResult = ActionResult<{ id: string; name: string }>;

// AS-331: only the template's creator OR a workspace admin/owner may
// rename it. RLS on `task_templates` (F181's
// task_templates_update_owner_or_admin policy) already enforces this
// exact rule at the database layer; this re-checks it explicitly
// server-side first (defense in depth, same convention as every sibling
// action in this file) so a permission failure maps to a specific
// message instead of a raw RLS-denied error surfacing from the admin
// client (which bypasses RLS entirely, so the app-level check here is
// the ONLY enforcement this action itself performs — consistent with
// every other admin-client-using action in this codebase).
export async function renameTemplate(
  templateId: string,
  newName: string,
): Promise<RenameTemplateResult> {
  const parsed = renameTemplateSchema.safeParse({
    templateId,
    name: newName,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid template details.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to rename a template." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: templateRow, error: templateError } = await admin
    .from("task_templates")
    .select("id, workspace_id, created_by")
    .eq("id", parsed.data.templateId)
    .maybeSingle();

  if (templateError || !templateRow) {
    return { ok: false, error: "Template not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    templateRow.workspace_id,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to rename this template.",
    };
  }

  const isCreator = templateRow.created_by === user.id;
  const isAdminOrOwner =
    membership.role === "owner" || membership.role === "admin";

  if (!isCreator && !isAdminOrOwner) {
    return {
      ok: false,
      error: "Only the template's creator or a workspace admin can rename it.",
    };
  }

  const { data: updated, error: updateError } = await admin
    .from("task_templates")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.templateId)
    .select("id, name")
    .single();

  if (updateError || !updated) {
    logger.error("renameTemplate: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", templateRow.workspace_id)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("renameTemplate: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return { ok: true, data: { id: updated.id, name: updated.name } };
}

// --- deleteTemplate ----------------------------------------------------------

export type DeleteTemplateResult = ActionResult<{ id: string }>;

// AS-331 (same permission rule as renameTemplate: creator or workspace
// admin/owner only). AS-332: deleting a template does not affect any task
// previously created from it — there is no FK from `tasks` back to
// `task_templates` at all (a created task is a fully independent row;
// the template was only read once, at createTaskFromTemplate time, to
// pre-fill the new row's columns). This action's DELETE statement only
// ever targets `task_templates`; it never touches `tasks`.
export async function deleteTemplate(
  templateId: string,
): Promise<DeleteTemplateResult> {
  const parsed = deleteTemplateSchema.safeParse({ templateId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid template.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to delete a template." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: templateRow, error: templateError } = await admin
    .from("task_templates")
    .select("id, workspace_id, created_by")
    .eq("id", parsed.data.templateId)
    .maybeSingle();

  if (templateError || !templateRow) {
    return { ok: false, error: "Template not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    templateRow.workspace_id,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to delete this template.",
    };
  }

  const isCreator = templateRow.created_by === user.id;
  const isAdminOrOwner =
    membership.role === "owner" || membership.role === "admin";

  if (!isCreator && !isAdminOrOwner) {
    return {
      ok: false,
      error: "Only the template's creator or a workspace admin can delete it.",
    };
  }

  const { error: deleteError } = await admin
    .from("task_templates")
    .delete()
    .eq("id", parsed.data.templateId);

  if (deleteError) {
    logger.error("deleteTemplate: delete failed", { error: deleteError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", templateRow.workspace_id)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("deleteTemplate: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return { ok: true, data: { id: parsed.data.templateId } };
}

// --- setDefaultTemplate -------------------------------------------------------

export type SetDefaultTemplateResult = ActionResult<{
  workspaceId: string;
  templateId: string | null;
}>;

// F001: sets (or clears, when `templateId` is null) the workspace's
// default `kind='project'` template — preselected by new-project-dialog's
// "Start from template" tab. Same permission rule renameTemplate/
// deleteTemplate already use (creator or workspace admin/owner), since
// "is the default template" is template metadata, same category as its
// name. `is_default` is scoped to `kind='project'` templates only (the
// migration's partial unique index is `(workspace_id, kind) where
// is_default`), so clearing/setting one template's default can never
// touch a `kind='task'` row's own (nonexistent) default state.
export async function setDefaultTemplate(
  workspaceId: string,
  templateId: string | null,
): Promise<SetDefaultTemplateResult> {
  const parsed = setDefaultTemplateSchema.safeParse({
    workspaceId,
    templateId,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid template.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to set a default template.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const membership = await requireActiveMembership(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to change templates in this workspace.",
    };
  }

  // Clearing the default: unset whichever `kind='project'` template in
  // this workspace currently holds it (at most one, per the partial
  // unique index), no target template row to authorize against — any
  // active non-guest member with write access may clear it, mirroring
  // canWrite's own bar for the other template-management controls, since
  // there's no single "creator" to defer to once nothing is selected.
  if (parsed.data.templateId === null) {
    if (!canWrite({ role: membership.role })) {
      return {
        ok: false,
        error: "Viewers don't have permission to change templates.",
      };
    }

    const { error: clearError } = await admin
      .from("task_templates")
      .update({ is_default: false })
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("kind", "project")
      .eq("is_default", true);

    if (clearError) {
      logger.error("setDefaultTemplate: clear failed", { error: clearError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const { data: workspaceRow } = await admin
      .from("workspaces")
      .select("slug")
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        logger.error("setDefaultTemplate: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: { workspaceId: parsed.data.workspaceId, templateId: null },
    };
  }

  const { data: templateRow, error: templateError } = await admin
    .from("task_templates")
    .select("id, workspace_id, kind, created_by")
    .eq("id", parsed.data.templateId)
    .maybeSingle();

  if (templateError || !templateRow) {
    return { ok: false, error: "Template not found." };
  }

  if (templateRow.workspace_id !== parsed.data.workspaceId) {
    return { ok: false, error: "Template not found." };
  }

  if (templateRow.kind !== "project") {
    return {
      ok: false,
      error: "Only project templates can be set as the default.",
    };
  }

  const isCreator = templateRow.created_by === user.id;
  const isAdminOrOwner =
    membership.role === "owner" || membership.role === "admin";

  if (!isCreator && !isAdminOrOwner) {
    return {
      ok: false,
      error: "Only the template's creator or a workspace admin can set it as default.",
    };
  }

  // Unset any existing default first, then set the new one — two
  // statements rather than relying on the partial unique index to
  // reject a would-be second default, since an UPSERT-style "set this
  // one, unset every other" can't be expressed as a single UPDATE
  // without an unsupported self-referencing WHERE. The unique index
  // still backstops this against a concurrent race (the second
  // statement below would fail its own constraint if another request
  // won first), same defense-in-depth posture every other write path in
  // this file already has on top of its app-level checks.
  const { error: clearError } = await admin
    .from("task_templates")
    .update({ is_default: false })
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("kind", "project")
    .eq("is_default", true);

  if (clearError) {
    logger.error("setDefaultTemplate: clear-existing-default failed", { error: clearError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { error: setError } = await admin
    .from("task_templates")
    .update({ is_default: true })
    .eq("id", parsed.data.templateId);

  if (setError) {
    logger.error("setDefaultTemplate: set failed", { error: setError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("setDefaultTemplate: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      workspaceId: parsed.data.workspaceId,
      templateId: parsed.data.templateId,
    },
  };
}

// --- saveProjectAsTemplate ---------------------------------------------------
// F184 (AS-333 setup): the "how does a project-kind template originate"
// question the spec's draft scope left open. Mirrors saveTaskAsTemplate
// above but at project scope: snapshots a project's current, non-deleted
// tasks (title/description/description_json/priority/checklist/estimate/
// tags — the SAME clonable fields cloneTaskFields/duplicateTask already
// establish, minus assigneeIds per this feature's own payload schema doc
// comment) into a new `task_templates` row with `kind = 'project'`, in
// the project's current board order (status column order todo -> done,
// then position within each column) so createProjectFromTemplate
// recreates them in a sensible order.

export type SaveProjectAsTemplateResult = ActionResult<{
        id: string;
        name: string;
        workspaceId: string;
        taskCount: number;
      }>;

const STATUS_ORDER: Record<string, number> = {
  todo: 0,
  in_progress: 1,
  in_review: 2,
  done: 3,
};

export async function saveProjectAsTemplate(
  projectId: string,
  name: string,
): Promise<SaveProjectAsTemplateResult> {
  const parsed = saveProjectAsTemplateSchema.safeParse({ projectId, name });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid template details.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to save a template." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id, deleted_at")
    .eq("id", parsed.data.projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (projectError || !projectRow) {
    return { ok: false, error: "Project not found." };
  }

  const workspaceId = projectRow.workspace_id;

  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to save a template from this project.",
    };
  }

  // Same write gate as saveTaskAsTemplate: saving a template creates a
  // new row, so viewers (read-only, AS-216/AS-217) are excluded.
  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to save templates.",
    };
  }

  // F001: `parent_task_id`/`phase_id` are read alongside the existing
  // clonable fields so the payload can capture the project's subtask
  // hierarchy (AS: children) and per-task phase (AS: phase name) — see
  // the tree-building and phase-name-resolution below.
  const { data: taskRows, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, title, description, description_json, priority, tags, estimate_minutes, status, position, parent_task_id, phase_id",
    )
    .eq("project_id", parsed.data.projectId)
    .is("deleted_at", null)
    .order("status", { ascending: true })
    .order("position", { ascending: true });

  if (taskError) {
    logger.error("saveProjectAsTemplate: task read failed", { error: taskError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const sortedTasks = (taskRows ?? []).slice().sort((a, b) => {
    const statusDelta =
      (STATUS_ORDER[a.status as string] ?? 99) -
      (STATUS_ORDER[b.status as string] ?? 99);
    if (statusDelta !== 0) return statusDelta;
    return (a.position as number) - (b.position as number);
  });

  const taskIds = sortedTasks.map((row) => row.id as string);

  const { data: checklistRows } = taskIds.length
    ? await admin
        .from("checklist_items")
        .select("task_id, content, position")
        .in("task_id", taskIds)
        .order("position", { ascending: true })
    : { data: [] as { task_id: string; content: string; position: number }[] };

  const checklistByTask = new Map<
    string,
    { content: string; position: number }[]
  >();
  for (const row of checklistRows ?? []) {
    const list = checklistByTask.get(row.task_id as string) ?? [];
    list.push({
      content: row.content as string,
      position: row.position as number,
    });
    checklistByTask.set(row.task_id as string, list);
  }

  // F006c (missions/20260903-portal, AS-009): snapshot this project's own
  // phases, ordered the same way `project_phases_project_id_position_idx`
  // (supabase/migrations/20260909010000_portal_foundations.sql) already
  // sorts them, so createProjectFromTemplate recreates them in the same
  // order. A project with zero phases (never seeded, or seeding skipped)
  // simply produces an empty `phases` array — the same "no phases
  // section" shape a pre-F006c template has, which
  // `create_project_from_template`'s `p_phases default '[]'::jsonb`
  // already handles.
  const { data: phaseRows, error: phaseError } = await admin
    .from("project_phases")
    .select("id, name, client_description, client_visible")
    .eq("project_id", parsed.data.projectId)
    .order("position", { ascending: true });

  if (phaseError) {
    logger.error("saveProjectAsTemplate: phase read failed", { error: phaseError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F013 (missions/20260903-portal, AS-028): snapshot this project's own
  // `client_deliverables`, same "ordered the same way the source table's
  // own index already sorts them" convention the phase read above uses.
  // `due_at` is converted to a relative `due_offset_days` (days from
  // today, at save time) rather than carried as an absolute date — see
  // `projectTemplateDeliverableSchema`'s own doc comment for why an
  // absolute date has no meaning inside a reusable template.
  const { data: deliverableRows, error: deliverableError } = await admin
    .from("client_deliverables")
    .select("title, description, kind, owner_name, due_at, blocking")
    .eq("project_id", parsed.data.projectId)
    .order("position", { ascending: true });

  if (deliverableError) {
    logger.error("saveProjectAsTemplate: deliverable read failed", { error: deliverableError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F080 (AS-165): snapshot this project's own brief questions, ordered
  // the same way brief_questions_project_id_idx-backed reads elsewhere
  // (lib/queries/brief.ts, lib/actions/brief.ts) already sort them --
  // `position` ascending. Deliberately selects only the question columns
  // (never brief_answers, which is keyed by brief_id, not project_id, so
  // there is nothing to accidentally join in here) -- see
  // projectTemplateBriefQuestionSchema's own comment for why "no answers"
  // holds structurally.
  const { data: briefQuestionRows, error: briefQuestionError } = await admin
    .from("brief_questions")
    .select("category, prompt, help_text, answer_type, options, required")
    .eq("project_id", parsed.data.projectId)
    .order("position", { ascending: true });

  if (briefQuestionError) {
    logger.error("saveProjectAsTemplate: brief question read failed", { error: briefQuestionError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // F001: phase_id -> phase name, so each task's `phase` field in the
  // payload can be a name (the join key `create_project_from_template`
  // matches against `p_phases[].name`, since a template's phases don't
  // have real ids until the RPC creates them for a NEW project).
  const phaseNameById = new Map<string, string>();
  for (const row of phaseRows ?? []) {
    phaseNameById.set(row.id as string, row.name as string);
  }

  type SourceTaskRow = (typeof sortedTasks)[number];

  function toPayloadTask(
    row: SourceTaskRow,
  ): ProjectTemplatePayload["tasks"][number] {
    // Every task's own `phase_id` is resolved independently, whether a
    // top-level task or a child — the RPC's own inheritance fallback
    // (a child with no `phase` key at all inherits its parent's
    // resolved phase) only matters for tasks that DON'T already carry
    // their own value, so a child that happens to share its parent's
    // phase round-trips correctly either way.
    const phaseName = row.phase_id
      ? phaseNameById.get(row.phase_id as string)
      : undefined;

    return {
      title: row.title as string,
      description: row.description as string | null,
      description_json: row.description_json,
      priority: row.priority as ProjectTemplatePayload["tasks"][number]["priority"],
      checklistItems: checklistByTask.get(row.id as string) ?? [],
      estimate_minutes: row.estimate_minutes as number | null,
      tags: (row as unknown as { tags?: string[] }).tags ?? [],
      phase: phaseName,
      children: childrenByParent
        .get(row.id as string)
        ?.map((child) => toPayloadTask(child)) ?? [],
    };
  }

  // F001: group the flat, already board-ordered `sortedTasks` list by
  // `parent_task_id` so the payload can nest subtasks under their parent
  // (mirrors `tasks.parent_task_id`, AS: children). Order within each
  // group is preserved from `sortedTasks`'s own status/position sort —
  // `Map` iteration/insertion order keeps that intact.
  const childrenByParent = new Map<string, SourceTaskRow[]>();
  for (const row of sortedTasks) {
    if (!row.parent_task_id) continue;
    const list = childrenByParent.get(row.parent_task_id as string) ?? [];
    list.push(row);
    childrenByParent.set(row.parent_task_id as string, list);
  }
  const topLevelTasks = sortedTasks.filter((row) => !row.parent_task_id);

  const payload: ProjectTemplatePayload = {
    tasks: topLevelTasks.map((row) => toPayloadTask(row)),
    phases: (phaseRows ?? []).map((row) => ({
      name: row.name as string,
      client_description: row.client_description as string | null,
      // F006h (AS-012/AS-009): carry the source phase's client visibility
      // through the template — see projectTemplatePhaseSchema's comment
      // in lib/validation/templates.ts for why this is captured alongside
      // name/client_description rather than left to default.
      client_visible: row.client_visible as boolean,
    })),
    deliverables: (deliverableRows ?? []).map((row) => {
      let dueOffsetDays: number | null = null;
      if (row.due_at) {
        const dueDate = new Date(`${row.due_at}T00:00:00Z`);
        dueOffsetDays = Math.round(
          (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
      }
      return {
        title: row.title as string,
        description: row.description as string | null,
        kind: row.kind as ProjectTemplateDeliverable["kind"],
        owner_name: row.owner_name as string,
        blocking: row.blocking as boolean,
        due_offset_days: dueOffsetDays,
      };
    }),
    briefQuestions: (briefQuestionRows ?? []).map((row) => ({
      category: row.category as string | null,
      prompt: row.prompt as string,
      help_text: row.help_text as string | null,
      answer_type: row.answer_type as ProjectTemplatePayload["briefQuestions"][number]["answer_type"],
      options: row.options as string[] | null,
      required: row.required as boolean,
    })),
  };

  const { data: inserted, error: insertError } = await admin
    .from("task_templates")
    .insert({
      workspace_id: workspaceId,
      kind: "project",
      name: parsed.data.name,
      payload: payload as unknown as Json,
      created_by: user.id,
    })
    .select("id, name, workspace_id")
    .single();

  if (insertError || !inserted) {
    logger.error("saveProjectAsTemplate: insert failed", { error: insertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("saveProjectAsTemplate: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      name: inserted.name,
      workspaceId: inserted.workspace_id,
      // F001: `payload.tasks.length` is only the TOP-LEVEL task count
      // now that subtasks nest under `children` instead of appearing as
      // their own flat array entries — `sortedTasks.length` (every
      // non-deleted task read from the project, parents and children
      // alike) is what a "N tasks saved" toast should actually report.
      taskCount: sortedTasks.length,
    },
  };
}

// --- createProjectFromTemplate -----------------------------------------------

export type CreateProjectFromTemplateResult = ActionResult<{
        id: string;
        key: string;
        name: string;
        workspaceId: string;
        taskCount: number;
      }>;

// AS-333: creates a new project AND every one of the template's tasks,
// in ONE atomic unit — delegated to the `create_project_from_template`
// Postgres function (supabase/migrations/
// 20260822190000_rpc_create_project_from_template.sql), which runs the
// project insert (firing F145's project-key trigger) and every task
// insert (firing F145's per-project task-number trigger, so each task
// gets its own key/number via the same atomic counter every other
// create path uses) inside a single function invocation — a single
// PL/pgSQL function body is one implicit transaction, so a failure
// anywhere in the loop (e.g. a malformed/empty task title tripping the
// `tasks_title_not_empty` CHECK) rolls back the ENTIRE call, including
// the project row that was inserted first. No orphaned project, no
// partial task set, ever.
export async function createProjectFromTemplate(
  templateId: string,
  workspaceId: string,
  name: string,
  description?: string | null,
): Promise<CreateProjectFromTemplateResult> {
  const parsed = createProjectFromTemplateSchema.safeParse({
    templateId,
    workspaceId,
    name,
    description: description ?? null,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid project details.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to create a project from a template.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireActiveMembership(); caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const membership = await requireActiveMembership(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to create a project in this workspace.",
    };
  }

  // FU-17 (SB-034): the shared project-create predicate, NOT canWrite --
  // canWrite permits guests, who must not be able to create projects.
  if (!canCreateProject({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to create projects in this workspace.",
    };
  }

  const { data: templateRow, error: templateError } = await admin
    .from("task_templates")
    .select("id, workspace_id, kind, payload")
    .eq("id", parsed.data.templateId)
    .maybeSingle();

  if (templateError || !templateRow) {
    return { ok: false, error: "Template not found." };
  }

  if (templateRow.kind !== "project") {
    return { ok: false, error: "This template is not a project template." };
  }

  // Same workspace-scoping rule createTaskFromTemplate enforces: a
  // template must be applied within its own workspace, never trusted
  // from a client-supplied workspaceId that happens to differ.
  if (templateRow.workspace_id !== parsed.data.workspaceId) {
    return { ok: false, error: "Template not found." };
  }

  const payloadParsed = projectTemplatePayloadSchema.safeParse(
    templateRow.payload,
  );

  if (!payloadParsed.success) {
    logger.error("createProjectFromTemplate: stored payload failed schema validation", { error: payloadParsed.error });
    return {
      ok: false,
      error: "This template's saved data is invalid. Please re-save it.",
    };
  }

  const payload = payloadParsed.data;

  const { data: rpcRows, error: rpcError } = await admin.rpc(
    "create_project_from_template",
    {
      p_workspace_id: parsed.data.workspaceId,
      p_name: parsed.data.name,
      p_description: (parsed.data.description ?? null) as unknown as string,
      p_created_by: user.id,
      p_tasks: payload.tasks as unknown as Json,
      // F006c (missions/20260903-portal, AS-009): seeded inside the SAME
      // RPC invocation as the project + tasks above — see
      // supabase/migrations/20260915010000_create_project_from_template_phases.sql.
      p_phases: payload.phases as unknown as Json,
      // F013 (missions/20260903-portal, AS-028): seeded inside the SAME
      // RPC invocation as the project + tasks + phases above — see
      // supabase/migrations/20260927020000_f013_project_template_deliverables.sql.
      p_deliverables: payload.deliverables as unknown as Json,
    },
  );

  if (rpcError) {
    logger.error("createProjectFromTemplate: create_project_from_template RPC failed", { error: rpcError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const created = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  if (!created) {
    logger.error("createProjectFromTemplate: create_project_from_template RPC returned no row");
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // Default view tabs (Setup/Design/Dev/QA): same best-effort provisioning
  // as lib/actions/projects.ts's createProject -- see that function's own
  // comment for the full rationale (empty-filter shared list views, no
  // task<->view membership yet). Duplicated rather than factored into a
  // shared helper purely because this is the ONLY other real
  // project-creation entry point in the codebase (confirmed by grep for
  // `createProject(` call sites) and a two-line duplication is cheaper
  // than a new shared module for exactly two callers.
  const DEFAULT_VIEW_NAMES = ["Setup", "Design", "Dev", "QA"];
  const { error: defaultViewsError } = await admin.from("saved_views").insert(
    DEFAULT_VIEW_NAMES.map((name, index) => ({
      workspace_id: parsed.data.workspaceId,
      project_id: created.project_id as string,
      owner_id: user.id,
      name,
      scope: "shared" as const,
      view_type: "list" as const,
      config: { filters: [], sort: [], groupBy: null },
      is_default: false,
      position: (index + 1) * 1000,
    })),
  );
  if (defaultViewsError) {
    logger.error("createProjectFromTemplate: default view tabs insert failed (non-fatal)", {
      error: defaultViewsError,
    });
  }

  // "Who approves what" decision types: same best-effort Design/Content
  // seeding as lib/actions/projects.ts's createProject -- see that
  // function's own comment for the full rationale. Duplicated for the
  // same "only two real project-creation entry points" reason the default
  // view tabs above already are.
  const DEFAULT_DECISION_TYPES = [
    { name: "Design", description: "Visual design, moodboards, page layouts." },
    { name: "Content", description: "Copy, sitemap structure, wording." },
  ];
  const { error: decisionTypesError } = await admin.from("project_decision_types").insert(
    DEFAULT_DECISION_TYPES.map((type, index) => ({
      project_id: created.project_id as string,
      name: type.name,
      description: type.description,
      sort_order: index + 1,
    })),
  );
  if (decisionTypesError) {
    logger.error("createProjectFromTemplate: default decision types insert failed (non-fatal)", {
      error: decisionTypesError,
    });
  }

  // F080 (AS-166/AS-167): seed the new project's brief_questions from the
  // template's snapshot, in the same order the template captured them
  // (payload.briefQuestions preserves saveProjectAsTemplate's `position
  // ascending` read order; `position` here is reassigned 0-based per new
  // row, mirroring the phases loop's own 1-based `position` reassignment
  // above rather than trying to preserve the source project's original
  // position values, which have no meaning once questions belong to a
  // different project). Best-effort, non-fatal on error -- same
  // convention as the default views/decision types inserts immediately
  // above (the project itself was already created successfully by the
  // RPC; this is additive seeding on top of that, not the action's
  // primary success signal). Deliberately does NOT touch brief_answers at
  // all -- there is no source `brief_id` to read answers from in the
  // template payload in the first place (AS-167: only questions are ever
  // captured, never answers).
  if (payload.briefQuestions.length > 0) {
    const { error: briefQuestionsInsertError } = await admin
      .from("brief_questions")
      .insert(
        payload.briefQuestions.map((question, index) => ({
          project_id: created.project_id as string,
          position: index * 1000,
          category: question.category,
          prompt: question.prompt,
          help_text: question.help_text,
          answer_type: question.answer_type,
          options: question.options,
          required: question.required,
        })),
      );

    if (briefQuestionsInsertError) {
      logger.error("createProjectFromTemplate: brief questions insert failed (non-fatal)", {
        error: briefQuestionsInsertError,
      });
    }
  }

  // AS-376 (F316, follow-up to F313): `create_project_from_template`
  // (supabase/migrations/20260822190000_rpc_create_project_from_template.sql)
  // copies each template task's description_json directly in its SQL body,
  // with no mention-visibility check at all — the RPC has to run and create
  // the project first, since sanitiseMentionsForVisibility's `{projectId,
  // workspaceId, projectVisibility}` context can't be built for a project
  // that doesn't exist yet. So this pass runs AFTER the RPC returns, against
  // the real, now-existing project id, re-fetching each inserted task's
  // description_json and re-running the exact same helper F313 already uses
  // in createTaskFromTemplate above — not a reimplementation of the rule.
  // Only tasks whose sanitised document actually differs get written back
  // (an UPDATE per changed task, not an unconditional one per task).
  //
  // Partial-failure handling mirrors bulkUpdateTasks' convention
  // (lib/actions/tasks.ts): the RPC already committed the project + all
  // tasks atomically in its own transaction, so there is nothing left to
  // roll back here, and one task's visibility check failing (F301's
  // MentionVisibilityCheckError — a transient DB read failure) must not
  // block every other task in the batch from still being checked. Each
  // task is sanitised independently; failures are logged and skipped
  // rather than aborting the whole loop or failing this action's result
  // (the project was created successfully; this is best-effort defense in
  // depth on top of that, not the primary success/failure signal for the
  // action).
  const { data: insertedTasks, error: insertedTasksError } = await admin
    .from("tasks")
    .select("id, description_json")
    .eq("project_id", created.project_id as string)
    .not("description_json", "is", null);

  if (insertedTasksError) {
    logger.error("createProjectFromTemplate: failed to re-fetch inserted tasks for mention sanitisation", { error: insertedTasksError });
  } else {
    const mentionCtx = {
      projectId: created.project_id as string,
      workspaceId: parsed.data.workspaceId,
      // The RPC never accepts/sets a visibility on the new project, so it
      // always carries the `projects` table's default ('workspace') at the
      // moment this runs, immediately after project creation in the same
      // request.
      projectVisibility: "workspace",
    };

    for (const task of insertedTasks ?? []) {
      if (!task.description_json) continue;
      try {
        const sanitised = (await sanitiseMentionsForVisibility(
          admin,
          task.description_json as unknown as JSONContent,
          mentionCtx,
        )) as JSONContent;

        if (
          JSON.stringify(sanitised) !== JSON.stringify(task.description_json)
        ) {
          const { error: updateError } = await admin
            .from("tasks")
            .update({ description_json: sanitised as Json })
            .eq("id", task.id);

          if (updateError) {
            logger.error("createProjectFromTemplate: failed to write back sanitised description_json for task", { taskId: task.id, error: updateError });
          }
        }
      } catch (visibilityError) {
        logger.error("createProjectFromTemplate: mention visibility check failed for task, retrying once", { taskId: task.id, error: visibilityError });
        // F320 (scrutiny pass 5): a bare log-and-skip here left the
        // original, UNSANITISED (potentially mention-exposing) document in
        // place on a transient check failure — worse than the "log and
        // skip the whole task" pattern this loop otherwise follows, because
        // skipping used to mean "leave it as-is" rather than "leave it
        // safe". Retry the real check once (transient DB errors are often
        // momentary); if it fails again, fall back to the conservative
        // `stripAllMentions` (strips every mention in this one task,
        // leaving the rest of the batch untouched) rather than leaving the
        // unsanitised original in place.
        try {
          const sanitisedRetry = (await sanitiseMentionsForVisibility(
            admin,
            task.description_json as unknown as JSONContent,
            mentionCtx,
          )) as JSONContent;

          if (
            JSON.stringify(sanitisedRetry) !==
            JSON.stringify(task.description_json)
          ) {
            const { error: updateError } = await admin
              .from("tasks")
              .update({ description_json: sanitisedRetry as Json })
              .eq("id", task.id);

            if (updateError) {
              logger.error("createProjectFromTemplate: failed to write back sanitised description_json for task (retry)", { taskId: task.id, error: updateError });
            }
          }
        } catch (retryError) {
          logger.error("createProjectFromTemplate: mention visibility check failed again for task, stripping all mentions as a safe fallback", { taskId: task.id, error: retryError });
          const stripped = stripAllMentions(
            task.description_json as unknown as JSONContent,
          );
          const { error: fallbackUpdateError } = await admin
            .from("tasks")
            .update({ description_json: stripped as Json })
            .eq("id", task.id);

          if (fallbackUpdateError) {
            logger.error("createProjectFromTemplate: failed to write back safe-fallback (all mentions stripped) description_json for task", { taskId: task.id, error: fallbackUpdateError });
          }
        }
      }
    }
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("createProjectFromTemplate: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: created.project_id as string,
      key: created.project_key as string,
      name: created.project_name as string,
      workspaceId: parsed.data.workspaceId,
      // F001: count the WHOLE tree (top-level tasks + every nested
      // `children` entry), not just `payload.tasks.length` — subtasks
      // are real created tasks too (AS: children), so a "created with N
      // tasks" toast undercounting them would be actively misleading.
      taskCount: countPayloadTasks(payload.tasks),
    },
  };
}

// F001: recursively counts every task in a project template payload's
// tree, top-level entries plus every nested `children` entry at every
// depth — shared by createProjectFromTemplate's result count above.
function countPayloadTasks(
  tasks: ProjectTemplatePayload["tasks"],
): number {
  let count = 0;
  for (const task of tasks) {
    count += 1 + countPayloadTasks(task.children ?? []);
  }
  return count;
}
