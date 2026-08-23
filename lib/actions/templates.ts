"use server";

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

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  saveTaskAsTemplateSchema,
  createTaskFromTemplateSchema,
  renameTemplateSchema,
  deleteTemplateSchema,
  taskTemplatePayloadSchema,
  saveProjectAsTemplateSchema,
  createProjectFromTemplateSchema,
  projectTemplatePayloadSchema,
  type TaskTemplatePayload,
  type ProjectTemplatePayload,
} from "@/lib/validation/templates";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite } from "@/lib/auth/permissions";
import { calculatePosition } from "@/lib/board/position";
import { cloneTaskFields } from "@/lib/recurrence/clone-fields";
import { sanitiseMentionsForVisibility } from "@/lib/comments/mentions";
import type { JSONContent } from "@/components/editor/rich-text-editor";
import type { Json } from "@/lib/supabase/database.types";

// --- saveTaskAsTemplate -----------------------------------------------------

export type SaveTaskAsTemplateResult =
  | {
      ok: true;
      data: {
        id: string;
        name: string;
        workspaceId: string;
      };
    }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to save a template." };
  }

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
    console.error("saveTaskAsTemplate: insert failed:", insertError);
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
      console.error(
        "saveTaskAsTemplate: revalidatePath failed (non-fatal):",
        revalidateError,
      );
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

export type CreateTaskFromTemplateResult =
  | {
      ok: true;
      data: {
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
      };
    }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to create a task from a template.",
    };
  }

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
    console.error(
      "createTaskFromTemplate: stored payload failed schema validation:",
      payloadParsed.error,
    );
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

  const targetStatus = parsed.data.status ?? "todo";

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
      console.error(
        "createTaskFromTemplate: mention visibility check failed:",
        visibilityError,
      );
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }
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
      // No `number`/key supplied: F145's assign_task_key trigger assigns
      // this new row its own project-sequential number on insert — the
      // template payload never carries a key/number to copy (it isn't in
      // taskTemplatePayloadSchema's shape at all).
    })
    .select("id, project_id, title, status, position, number")
    .single();

  if (insertError || !inserted) {
    console.error("createTaskFromTemplate: insert failed:", insertError);
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
      console.error(
        "createTaskFromTemplate: checklist insert failed:",
        checklistInsertError,
      );
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
      console.error(
        "createTaskFromTemplate: assignee insert failed:",
        assigneeInsertError,
      );
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
      console.error(
        "createTaskFromTemplate: revalidatePath failed (non-fatal):",
        revalidateError,
      );
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

export type RenameTemplateResult =
  | { ok: true; data: { id: string; name: string } }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to rename a template." };
  }

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
    console.error("renameTemplate: update failed:", updateError);
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
      console.error(
        "renameTemplate: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return { ok: true, data: { id: updated.id, name: updated.name } };
}

// --- deleteTemplate ----------------------------------------------------------

export type DeleteTemplateResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to delete a template." };
  }

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
    console.error("deleteTemplate: delete failed:", deleteError);
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
      console.error(
        "deleteTemplate: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return { ok: true, data: { id: parsed.data.templateId } };
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

export type SaveProjectAsTemplateResult =
  | {
      ok: true;
      data: {
        id: string;
        name: string;
        workspaceId: string;
        taskCount: number;
      };
    }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to save a template." };
  }

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

  const { data: taskRows, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, title, description, description_json, priority, tags, estimate_minutes, status, position",
    )
    .eq("project_id", parsed.data.projectId)
    .is("deleted_at", null)
    .order("status", { ascending: true })
    .order("position", { ascending: true });

  if (taskError) {
    console.error("saveProjectAsTemplate: task read failed:", taskError);
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

  const payload: ProjectTemplatePayload = {
    tasks: sortedTasks.map((row) => ({
      title: row.title as string,
      description: row.description as string | null,
      description_json: row.description_json,
      priority: row.priority as ProjectTemplatePayload["tasks"][number]["priority"],
      checklistItems: checklistByTask.get(row.id as string) ?? [],
      estimate_minutes: row.estimate_minutes as number | null,
      tags: (row as unknown as { tags?: string[] }).tags ?? [],
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
    console.error("saveProjectAsTemplate: insert failed:", insertError);
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
      console.error(
        "saveProjectAsTemplate: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      name: inserted.name,
      workspaceId: inserted.workspace_id,
      taskCount: payload.tasks.length,
    },
  };
}

// --- createProjectFromTemplate -----------------------------------------------

export type CreateProjectFromTemplateResult =
  | {
      ok: true;
      data: {
        id: string;
        key: string;
        name: string;
        workspaceId: string;
        taskCount: number;
      };
    }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to create a project from a template.",
    };
  }

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

  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to create projects.",
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
    console.error(
      "createProjectFromTemplate: stored payload failed schema validation:",
      payloadParsed.error,
    );
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
    },
  );

  if (rpcError) {
    console.error(
      "createProjectFromTemplate: create_project_from_template RPC failed:",
      rpcError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const created = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  if (!created) {
    console.error(
      "createProjectFromTemplate: create_project_from_template RPC returned no row",
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
    console.error(
      "createProjectFromTemplate: failed to re-fetch inserted tasks for mention sanitisation:",
      insertedTasksError,
    );
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
            console.error(
              "createProjectFromTemplate: failed to write back sanitised description_json for task",
              task.id,
              updateError,
            );
          }
        }
      } catch (visibilityError) {
        console.error(
          "createProjectFromTemplate: mention visibility check failed for task",
          task.id,
          visibilityError,
        );
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
      console.error(
        "createProjectFromTemplate: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: created.project_id as string,
      key: created.project_key as string,
      name: created.project_name as string,
      workspaceId: parsed.data.workspaceId,
      taskCount: payload.tasks.length,
    },
  };
}
